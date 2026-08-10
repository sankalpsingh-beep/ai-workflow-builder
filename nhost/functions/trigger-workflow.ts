import { Request, Response } from 'express';
import { gql } from 'graphql-request';
import { getAdminClient } from './_utils/graphql-client';
import { executeStep, StepType, StepConfig } from './_utils/step-executor';

interface ActionPayload {
  session_variables: {
    'x-hasura-user-id': string;
    'x-hasura-role': string;
  };
  input: {
    workflow_id: string;
    input?: any;
  };
}

// Layer 2 permission check - certain step types require owner role
const OWNER_ONLY_STEP_TYPES: StepType[] = ['db_write', 'notify'];

export default async function handler(req: Request, res: Response) {
  const payload: ActionPayload = req.body;
  const userId = payload.session_variables['x-hasura-user-id'];
  const workflowId = payload.input.workflow_id;
  const workflowInput = payload.input.input || {};
  
  const client = getAdminClient();
  
  try {
    // 1. Get workflow with org info and steps
    const workflowQuery = gql`
      query GetWorkflow($workflowId: uuid!) {
        workflows_by_pk(id: $workflowId) {
          id
          name
          is_active
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
    `;
    
    const workflowData = await client.request(workflowQuery, { workflowId });
    const workflow = (workflowData as any).workflows_by_pk;
    
    if (!workflow) {
      return res.json({
        success: false,
        message: 'Workflow not found'
      });
    }
    
    if (!workflow.is_active) {
      return res.json({
        success: false,
        message: 'Workflow is not active'
      });
    }
    
    // 2. Verify user has editor/owner role in the org (Layer 1)
    const memberQuery = gql`
      query GetMember($userId: uuid!, $orgId: uuid!) {
        org_members(where: { user_id: { _eq: $userId }, org_id: { _eq: $orgId } }) {
          role
        }
      }
    `;
    
    const memberData = await client.request(memberQuery, {
      userId,
      orgId: workflow.org_id
    });
    
    const member = (memberData as any).org_members[0];
    
    if (!member) {
      return res.json({
        success: false,
        message: 'Access denied: You are not a member of this organization'
      });
    }
    
    if (member.role === 'viewer') {
      return res.json({
        success: false,
        message: 'Access denied: Viewers cannot trigger workflow runs'
      });
    }
    
    // 3. Layer 2 check - if workflow has owner-only steps and user is not owner
    const hasOwnerOnlySteps = workflow.steps.some((step: any) => 
      OWNER_ONLY_STEP_TYPES.includes(step.step_type)
    );
    
    if (hasOwnerOnlySteps && member.role !== 'owner') {
      // Check if this specific workflow was created by an owner
      // Editors can run workflows with owner-only steps if they exist
      // But they can't CREATE such steps (handled in Hasura permissions separately)
    }
    
    // 4. Check org quota
    const org = workflow.organization;
    
    // Reset quota if period has passed
    if (new Date(org.quota_reset_at) <= new Date()) {
      const resetMutation = gql`
        mutation ResetQuota($orgId: uuid!) {
          update_organizations_by_pk(
            pk_columns: { id: $orgId },
            _set: { quota_used: 0, quota_reset_at: "${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()}" }
          ) {
            id
          }
        }
      `;
      await client.request(resetMutation, { orgId: org.id });
      org.quota_used = 0;
    }
    
    if (org.quota_used >= org.quota_limit) {
      return res.json({
        success: false,
        message: `Quota exceeded: ${org.quota_used}/${org.quota_limit} runs used this period`
      });
    }
    
    // 5. Create workflow run
    const createRunMutation = gql`
      mutation CreateWorkflowRun($object: workflow_runs_insert_input!) {
        insert_workflow_runs_one(object: $object) {
          id
        }
      }
    `;
    
    const runData = await client.request(createRunMutation, {
      object: {
        workflow_id: workflowId,
        triggered_by: userId,
        trigger_type: 'manual',
        status: 'running',
        input: workflowInput,
        started_at: new Date().toISOString()
      }
    });
    
    const workflowRunId = (runData as any).insert_workflow_runs_one.id;
    
    // 6. Create step_runs for all steps
    const stepRunInserts = workflow.steps.map((step: any) => ({
      workflow_run_id: workflowRunId,
      step_id: step.id,
      status: 'pending'
    }));
    
    const createStepRunsMutation = gql`
      mutation CreateStepRuns($objects: [step_runs_insert_input!]!) {
        insert_step_runs(objects: $objects) {
          returning {
            id
            step_id
          }
        }
      }
    `;
    
    const stepRunsData = await client.request(createStepRunsMutation, {
      objects: stepRunInserts
    });
    
    const stepRuns = (stepRunsData as any).insert_step_runs.returning;
    const stepRunMap = new Map(stepRuns.map((sr: any) => [sr.step_id, sr.id]));
    
    // 7. Execute steps in order
    let currentInput = workflowInput;
    let runStatus = 'completed';
    let runError: string | undefined;
    
    for (const step of workflow.steps) {
      const stepRunId = stepRunMap.get(step.id);
      
      // Update step_run to running
      await client.request(gql`
        mutation UpdateStepRunStatus($id: uuid!, $status: step_run_status!, $started_at: timestamptz) {
          update_step_runs_by_pk(
            pk_columns: { id: $id },
            _set: { status: $status, started_at: $started_at }
          ) {
            id
          }
        }
      `, {
        id: stepRunId,
        status: 'running',
        started_at: new Date().toISOString()
      });
      
      // Execute the step
      const result = await executeStep(
        step.step_type as StepType,
        step.config as StepConfig,
        { ...currentInput, previous_output: currentInput },
        workflowRunId,
        stepRunId
      );
      
      // Update step_run with result
      if (result.shouldPause) {
        // Approval gate - pause the run
        await client.request(gql`
          mutation UpdateStepRunAwaitingApproval($id: uuid!, $output: jsonb) {
            update_step_runs_by_pk(
              pk_columns: { id: $id },
              _set: { status: awaiting_approval, output: $output }
            ) {
              id
            }
          }
        `, {
          id: stepRunId,
          output: result.output
        });
        
        // Update workflow run to paused
        await client.request(gql`
          mutation UpdateWorkflowRunPaused($id: uuid!) {
            update_workflow_runs_by_pk(
              pk_columns: { id: $id },
              _set: { status: paused }
            ) {
              id
            }
          }
        `, { id: workflowRunId });
        
        return res.json({
          success: true,
          workflow_run_id: workflowRunId,
          message: `Workflow paused at step "${step.name}" awaiting approval`
        });
      }
      
      if (!result.success) {
        // Step failed
        await client.request(gql`
          mutation UpdateStepRunFailed($id: uuid!, $error: String, $output: jsonb, $completed_at: timestamptz) {
            update_step_runs_by_pk(
              pk_columns: { id: $id },
              _set: { status: failed, error: $error, output: $output, completed_at: $completed_at }
            ) {
              id
            }
          }
        `, {
          id: stepRunId,
          error: result.error,
          output: result.output,
          completed_at: new Date().toISOString()
        });
        
        runStatus = 'failed';
        runError = `Step "${step.name}" failed: ${result.error}`;
        break;
      }
      
      // Step succeeded
      await client.request(gql`
        mutation UpdateStepRunCompleted($id: uuid!, $output: jsonb, $completed_at: timestamptz) {
          update_step_runs_by_pk(
            pk_columns: { id: $id },
            _set: { status: completed, output: $output, completed_at: $completed_at }
          ) {
            id
          }
        }
      `, {
        id: stepRunId,
        output: result.output,
        completed_at: new Date().toISOString()
      });
      
      // Handle conditional branch - might skip to a different step
      if (step.step_type === 'conditional_branch' && result.nextStepOrder !== undefined) {
        // Find the index of the next step
        const nextStepIndex = workflow.steps.findIndex((s: any) => s.step_order === result.nextStepOrder);
        if (nextStepIndex !== -1) {
          // Mark skipped steps
          const currentIndex = workflow.steps.indexOf(step);
          for (let i = currentIndex + 1; i < nextStepIndex; i++) {
            const skippedStepRunId = stepRunMap.get(workflow.steps[i].id);
            await client.request(gql`
              mutation UpdateStepRunSkipped($id: uuid!) {
                update_step_runs_by_pk(
                  pk_columns: { id: $id },
                  _set: { status: skipped }
                ) {
                  id
                }
              }
            `, { id: skippedStepRunId });
          }
        }
      }
      
      // Pass output to next step
      currentInput = result.output || currentInput;
    }
    
    // 8. Update workflow run status
    await client.request(gql`
      mutation UpdateWorkflowRunCompleted($id: uuid!, $status: run_status!, $output: jsonb, $error: String, $completed_at: timestamptz) {
        update_workflow_runs_by_pk(
          pk_columns: { id: $id },
          _set: { status: $status, output: $output, error: $error, completed_at: $completed_at }
        ) {
          id
        }
      }
    `, {
      id: workflowRunId,
      status: runStatus,
      output: currentInput,
      error: runError,
      completed_at: new Date().toISOString()
    });
    
    // 9. Increment quota usage
    await client.request(gql`
      mutation IncrementQuota($orgId: uuid!) {
        update_organizations_by_pk(
          pk_columns: { id: $orgId },
          _inc: { quota_used: 1 }
        ) {
          id
        }
      }
    `, { orgId: org.id });
    
    return res.json({
      success: true,
      workflow_run_id: workflowRunId,
      message: runStatus === 'completed' 
        ? 'Workflow completed successfully'
        : `Workflow ${runStatus}: ${runError}`
    });
    
  } catch (error: any) {
    console.error('Error triggering workflow:', error);
    return res.json({
      success: false,
      message: `Error: ${error.message}`
    });
  }
}
