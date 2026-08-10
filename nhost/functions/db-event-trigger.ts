import { Request, Response } from 'express';
import { gql } from 'graphql-request';
import { getAdminClient } from './_utils/graphql-client';
import { executeStep, StepType, StepConfig } from './_utils/step-executor';

/**
 * Database Event Trigger Handler
 * 
 * This function is called by Hasura when a row is inserted/updated/deleted
 * on a watched table. It finds workflows with database_event triggers
 * configured for that table and executes them.
 * 
 * Hasura Event Trigger payload structure:
 * {
 *   "event": {
 *     "session_variables": {...},
 *     "op": "INSERT" | "UPDATE" | "DELETE",
 *     "data": {
 *       "old": {...} | null,
 *       "new": {...} | null
 *     }
 *   },
 *   "created_at": "2024-01-01T00:00:00.000Z",
 *   "id": "event-uuid",
 *   "delivery_info": {...},
 *   "trigger": {
 *     "name": "trigger_name"
 *   },
 *   "table": {
 *     "schema": "public",
 *     "name": "table_name"
 *   }
 * }
 */

interface HasuraEventPayload {
  event: {
    session_variables: Record<string, string>;
    op: 'INSERT' | 'UPDATE' | 'DELETE';
    data: {
      old: Record<string, any> | null;
      new: Record<string, any> | null;
    };
  };
  created_at: string;
  id: string;
  trigger: {
    name: string;
  };
  table: {
    schema: string;
    name: string;
  };
}

export default async function handler(req: Request, res: Response) {
  const payload: HasuraEventPayload = req.body;
  const { table, event } = payload;
  const tableName = table.name;
  const operation = event.op;
  
  const client = getAdminClient();
  
  try {
    // Find all active database_event triggers for this table and operation
    const triggersQuery = gql`
      query GetDatabaseEventTriggers($tableName: String!) {
        workflow_triggers(where: {
          trigger_type: { _eq: database_event },
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
              id
              quota_used
              quota_limit
              quota_reset_at
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
    
    const triggersData = await client.request(triggersQuery, { tableName });
    const allTriggers = (triggersData as any).workflow_triggers;
    
    // Filter triggers that match this table and operation
    const matchingTriggers = allTriggers.filter((trigger: any) => {
      const config = trigger.config || {};
      const configTable = config.table || 'workflow_logs';
      const configOp = config.operation || 'INSERT';
      
      return configTable === tableName && configOp === operation;
    });
    
    if (matchingTriggers.length === 0) {
      return res.json({
        success: true,
        message: `No triggers configured for ${operation} on ${tableName}`
      });
    }
    
    const results: any[] = [];
    
    for (const trigger of matchingTriggers) {
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
      
      // Prepare input from event data
      const eventInput = {
        event_id: payload.id,
        table: tableName,
        operation: operation,
        data: event.data.new || event.data.old,
        old_data: event.data.old,
        new_data: event.data.new,
        created_at: payload.created_at
      };
      
      // Create workflow run
      const runData = await client.request(gql`
        mutation CreateEventRun($object: workflow_runs_insert_input!) {
          insert_workflow_runs_one(object: $object) { id }
        }
      `, {
        object: {
          workflow_id: workflow.id,
          trigger_id: trigger.id,
          trigger_type: 'database_event',
          status: 'running',
          input: eventInput,
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
      let currentInput = eventInput;
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
          runStatus = 'paused';
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
          runError = `Step "${step.name}" failed: ${result.error}`;
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
        
        // Handle conditional branch
        if (step.step_type === 'conditional_branch' && result.nextStepOrder !== undefined) {
          const nextStepIndex = workflow.steps.findIndex((s: any) => s.step_order === result.nextStepOrder);
          if (nextStepIndex !== -1) {
            const currentIndex = workflow.steps.indexOf(step);
            // Mark skipped steps
            for (let i = currentIndex + 1; i < nextStepIndex; i++) {
              const skippedStepRunId = stepRunMap.get(workflow.steps[i].id);
              await client.request(gql`
                mutation SkipStep($id: uuid!) {
                  update_step_runs_by_pk(pk_columns: { id: $id }, _set: { status: skipped }) { id }
                }
              `, { id: skippedStepRunId });
            }
          }
        }
        
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
    console.error('Database event trigger error:', error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}
