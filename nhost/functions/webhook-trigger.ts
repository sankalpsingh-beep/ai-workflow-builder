import { Request, Response } from 'express';
import { gql } from 'graphql-request';
import { getAdminClient } from './_utils/graphql-client';
import { executeStep, StepType, StepConfig } from './_utils/step-executor';

interface WebhookPayload {
  input: {
    workflow_id: string;
    webhook_secret: string;
    payload?: any;
  };
}

export default async function handler(req: Request, res: Response) {
  const payload: WebhookPayload = req.body;
  const { workflow_id, webhook_secret, payload: webhookPayload } = payload.input;
  
  const client = getAdminClient();
  
  try {
    // 1. Get workflow with webhook trigger
    const triggerQuery = gql`
      query GetWebhookTrigger($workflowId: uuid!, $secret: String!) {
        workflow_triggers(where: {
          workflow_id: { _eq: $workflowId },
          trigger_type: { _eq: webhook },
          webhook_secret: { _eq: $secret },
          is_active: { _eq: true }
        }) {
          id
          workflow {
            id
            name
            is_active
            org_id
            organization {
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

    const triggerData = await client.request(triggerQuery, {
      workflowId: workflow_id,
      secret: webhook_secret
    });
    
    const triggers = (triggerData as any).workflow_triggers;
    
    if (!triggers || triggers.length === 0) {
      return res.json({
        success: false,
        message: 'Invalid webhook: workflow not found or secret mismatch'
      });
    }
    
    const trigger = triggers[0];
    const workflow = trigger.workflow;
    
    if (!workflow.is_active) {
      return res.json({
        success: false,
        message: 'Workflow is not active'
      });
    }
    
    // 2. Check org quota
    const org = workflow.organization;
    if (org.quota_used >= org.quota_limit) {
      return res.json({
        success: false,
        message: `Quota exceeded: ${org.quota_used}/${org.quota_limit}`
      });
    }
    
    // 3. Create workflow run
    const createRunMutation = gql`
      mutation CreateWebhookRun($object: workflow_runs_insert_input!) {
        insert_workflow_runs_one(object: $object) {
          id
        }
      }
    `;
    
    const runData = await client.request(createRunMutation, {
      object: {
        workflow_id: workflow.id,
        trigger_id: trigger.id,
        trigger_type: 'webhook',
        status: 'running',
        input: webhookPayload || {},
        started_at: new Date().toISOString()
      }
    });
    
    const workflowRunId = (runData as any).insert_workflow_runs_one.id;

    // 4. Create step_runs
    const stepRunInserts = workflow.steps.map((step: any) => ({
      workflow_run_id: workflowRunId,
      step_id: step.id,
      status: 'pending'
    }));
    
    const createStepRunsMutation = gql`
      mutation CreateStepRuns($objects: [step_runs_insert_input!]!) {
        insert_step_runs(objects: $objects) {
          returning { id step_id }
        }
      }
    `;
    
    const stepRunsData = await client.request(createStepRunsMutation, {
      objects: stepRunInserts
    });
    
    const stepRuns = (stepRunsData as any).insert_step_runs.returning;
    const stepRunMap = new Map(stepRuns.map((sr: any) => [sr.step_id, sr.id]));
    
    // 5. Execute steps
    let currentInput = webhookPayload || {};
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
        
        return res.json({
          success: true,
          workflow_run_id: workflowRunId,
          message: `Workflow paused at step "${step.name}" awaiting approval`
        });
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
      
      currentInput = result.output || currentInput;
    }

    // 6. Finalize run
    await client.request(gql`
      mutation FinalizeRun($id: uuid!, $status: run_status!, $output: jsonb, $error: String) {
        update_workflow_runs_by_pk(
          pk_columns: { id: $id },
          _set: { 
            status: $status, 
            output: $output, 
            error: $error, 
            completed_at: "${new Date().toISOString()}" 
          }
        ) { id }
      }
    `, { 
      id: workflowRunId, 
      status: runStatus, 
      output: currentInput, 
      error: runError 
    });
    
    // 7. Increment quota
    await client.request(gql`
      mutation IncrementQuota($orgId: uuid!) {
        update_organizations_by_pk(
          pk_columns: { id: $orgId },
          _inc: { quota_used: 1 }
        ) { id }
      }
    `, { orgId: workflow.org_id });
    
    return res.json({
      success: true,
      workflow_run_id: workflowRunId,
      message: runStatus === 'completed' 
        ? 'Workflow completed successfully'
        : `Workflow ${runStatus}: ${runError}`
    });
    
  } catch (error: any) {
    console.error('Webhook trigger error:', error);
    return res.json({
      success: false,
      message: `Error: ${error.message}`
    });
  }
}
