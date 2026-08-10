import { Request, Response } from 'express';
import { gql } from 'graphql-request';
import { getAdminClient } from './_utils/graphql-client';
import { executeStep, StepType, StepConfig } from './_utils/step-executor';

// Simple cron parser - checks if current time matches cron expression
function cronMatches(cronExpression: string): boolean {
  const now = new Date();
  const parts = cronExpression.split(' ');
  
  if (parts.length !== 5) return false;
  
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  
  const matches = (value: string, current: number, max: number): boolean => {
    if (value === '*') return true;
    if (value.includes('/')) {
      const [, step] = value.split('/');
      return current % parseInt(step) === 0;
    }
    if (value.includes(',')) {
      return value.split(',').map(v => parseInt(v)).includes(current);
    }
    if (value.includes('-')) {
      const [start, end] = value.split('-').map(v => parseInt(v));
      return current >= start && current <= end;
    }
    return parseInt(value) === current;
  };
  
  return (
    matches(minute, now.getMinutes(), 59) &&
    matches(hour, now.getHours(), 23) &&
    matches(dayOfMonth, now.getDate(), 31) &&
    matches(month, now.getMonth() + 1, 12) &&
    matches(dayOfWeek, now.getDay(), 6)
  );
}

export default async function handler(req: Request, res: Response) {
  const client = getAdminClient();
  
  try {
    // Find all active scheduled triggers
    const triggersQuery = gql`
      query GetScheduledTriggers {
        workflow_triggers(where: {
          trigger_type: { _eq: scheduled },
          is_active: { _eq: true },
          workflow: { is_active: { _eq: true } }
        }) {
          id
          config
          workflow {
            id
            name
            org_id
            organization {
              quota_used
              quota_limit
            }
            steps(order_by: { step_order: asc }) {
              id
              name
              step_type
              step_order
              config
            }
          }
        }
      }
    `;
    
    const triggersData = await client.request(triggersQuery);
    const triggers = (triggersData as any).workflow_triggers;
    
    const results: any[] = [];
    
    for (const trigger of triggers) {
      const cronExpression = trigger.config?.cron || '* * * * *';
      
      if (!cronMatches(cronExpression)) {
        continue;
      }
      
      const workflow = trigger.workflow;
      const org = workflow.organization;
      
      // Check quota
      if (org.quota_used >= org.quota_limit) {
        results.push({
          workflow_id: workflow.id,
          success: false,
          message: 'Quota exceeded'
        });
        continue;
      }

      // Create workflow run
      const runData = await client.request(gql`
        mutation CreateScheduledRun($object: workflow_runs_insert_input!) {
          insert_workflow_runs_one(object: $object) { id }
        }
      `, {
        object: {
          workflow_id: workflow.id,
          trigger_id: trigger.id,
          trigger_type: 'scheduled',
          status: 'running',
          input: trigger.config?.input || {},
          started_at: new Date().toISOString()
        }
      });
      
      const workflowRunId = (runData as any).insert_workflow_runs_one.id;
      
      // Create step_runs
      const stepRunInserts = workflow.steps.map((step: any) => ({
        workflow_run_id: workflowRunId,
        step_id: step.id,
        status: 'pending'
      }));
      
      const stepRunsData = await client.request(gql`
        mutation CreateStepRuns($objects: [step_runs_insert_input!]!) {
          insert_step_runs(objects: $objects) {
            returning { id step_id }
          }
        }
      `, { objects: stepRunInserts });
      
      const stepRuns = (stepRunsData as any).insert_step_runs.returning;
      const stepRunMap = new Map(stepRuns.map((sr: any) => [sr.step_id, sr.id]));
      
      // Execute steps
      let currentInput = trigger.config?.input || {};
      let runStatus = 'completed';
      let runError: string | undefined;

      for (const step of workflow.steps) {
        const stepRunId = stepRunMap.get(step.id);
        
        await client.request(gql`
          mutation SetRunning($id: uuid!) {
            update_step_runs_by_pk(
              pk_columns: { id: $id },
              _set: { status: running, started_at: "${new Date().toISOString()}" }
            ) { id }
          }
        `, { id: stepRunId });
        
        const result = await executeStep(
          step.step_type as StepType,
          step.config as StepConfig,
          { ...currentInput, previous_output: currentInput },
          workflowRunId,
          stepRunId
        );
        
        if (result.shouldPause) {
          await client.request(gql`
            mutation PauseStep($id: uuid!, $output: jsonb) {
              update_step_runs_by_pk(
                pk_columns: { id: $id },
                _set: { status: awaiting_approval, output: $output }
              ) { id }
            }
          `, { id: stepRunId, output: result.output });
          
          await client.request(gql`
            mutation PauseRun($id: uuid!) {
              update_workflow_runs_by_pk(
                pk_columns: { id: $id },
                _set: { status: paused }
              ) { id }
            }
          `, { id: workflowRunId });
          
          results.push({
            workflow_id: workflow.id,
            workflow_run_id: workflowRunId,
            success: true,
            message: `Paused at step "${step.name}"`
          });
          break;
        }

        if (!result.success) {
          await client.request(gql`
            mutation FailStep($id: uuid!, $error: String, $output: jsonb) {
              update_step_runs_by_pk(
                pk_columns: { id: $id },
                _set: { status: failed, error: $error, output: $output, completed_at: "${new Date().toISOString()}" }
              ) { id }
            }
          `, { id: stepRunId, error: result.error, output: result.output });
          
          runStatus = 'failed';
          runError = result.error;
          break;
        }
        
        await client.request(gql`
          mutation CompleteStep($id: uuid!, $output: jsonb) {
            update_step_runs_by_pk(
              pk_columns: { id: $id },
              _set: { status: completed, output: $output, completed_at: "${new Date().toISOString()}" }
            ) { id }
          }
        `, { id: stepRunId, output: result.output });
        
        currentInput = result.output || currentInput;
      }
      
      // Finalize run if not paused
      if (runStatus !== 'paused') {
        await client.request(gql`
          mutation FinalizeRun($id: uuid!, $status: run_status!, $output: jsonb, $error: String) {
            update_workflow_runs_by_pk(
              pk_columns: { id: $id },
              _set: { status: $status, output: $output, error: $error, completed_at: "${new Date().toISOString()}" }
            ) { id }
          }
        `, { id: workflowRunId, status: runStatus, output: currentInput, error: runError });
        
        // Increment quota
        await client.request(gql`
          mutation IncrementQuota($orgId: uuid!) {
            update_organizations_by_pk(pk_columns: { id: $orgId }, _inc: { quota_used: 1 }) { id }
          }
        `, { orgId: workflow.org_id });
        
        results.push({
          workflow_id: workflow.id,
          workflow_run_id: workflowRunId,
          success: runStatus === 'completed',
          message: runStatus === 'completed' ? 'Completed' : runError
        });
      }
    }
    
    return res.json({ success: true, results });
  } catch (error: any) {
    console.error('Scheduled trigger error:', error);
    return res.json({ success: false, message: error.message });
  }
}
