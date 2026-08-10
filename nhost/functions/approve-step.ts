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
    step_run_id: string;
  };
}

export default async function handler(req: Request, res: Response) {
  const payload: ActionPayload = req.body;
  const userId = payload.session_variables['x-hasura-user-id'];
  const stepRunId = payload.input.step_run_id;
  
  const client = getAdminClient();
  
  try {
    // 1. Get step_run with workflow and org info
    const stepRunQuery = gql`
      query GetStepRun($stepRunId: uuid!) {
        step_runs_by_pk(id: $stepRunId) {
          id
          status
          output
          step {
            id
            step_type
            config
            step_order
            workflow {
              id
              org_id
              steps(order_by: { step_order: asc }) {
                id
                name
                step_type
                step_order
                config
              }
            }
          }
          workflow_run {
            id
            status
            input
          }
        }
      }
    `;

    const stepRunData = await client.request(stepRunQuery, { stepRunId });
    const stepRun = (stepRunData as any).step_runs_by_pk;
    
    if (!stepRun) {
      return res.json({ success: false, message: 'Step run not found' });
    }
    
    if (stepRun.status !== 'awaiting_approval') {
      return res.json({ 
        success: false, 
        message: `Step is not awaiting approval (current status: ${stepRun.status})` 
      });
    }
    
    const workflow = stepRun.step.workflow;
    const workflowRun = stepRun.workflow_run;
    
    // 2. LAYER 2 PERMISSION CHECK: Verify user has required role to approve
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

    // Check required role from approval_gate config
    const requiredRole = stepRun.step.config?.required_role || 'editor';
    
    if (requiredRole === 'owner' && member.role !== 'owner') {
      return res.json({
        success: false,
        message: 'Access denied: Only owners can approve this step'
      });
    }
    
    if (member.role === 'viewer') {
      return res.json({
        success: false,
        message: 'Access denied: Viewers cannot approve steps'
      });
    }
    
    // 3. Approve the step
    await client.request(gql`
      mutation ApproveStep($id: uuid!, $approved_by: uuid!, $approved_at: timestamptz) {
        update_step_runs_by_pk(
          pk_columns: { id: $id },
          _set: { 
            status: completed, 
            approved_by: $approved_by, 
            approved_at: $approved_at,
            completed_at: $approved_at
          }
        ) { id }
      }
    `, {
      id: stepRunId,
      approved_by: userId,
      approved_at: new Date().toISOString()
    });
    
    // 4. Resume workflow - continue from next step
    const currentStepOrder = stepRun.step.step_order;
    const remainingSteps = workflow.steps.filter(
      (s: any) => s.step_order > currentStepOrder
    );

    if (remainingSteps.length === 0) {
      // No more steps - complete the workflow run
      await client.request(gql`
        mutation CompleteWorkflowRun($id: uuid!) {
          update_workflow_runs_by_pk(
            pk_columns: { id: $id },
            _set: { status: completed, completed_at: "${new Date().toISOString()}" }
          ) { id }
        }
      `, { id: workflowRun.id });
      
      return res.json({
        success: true,
        message: 'Step approved and workflow completed'
      });
    }
    
    // Update workflow run to running
    await client.request(gql`
      mutation ResumeWorkflowRun($id: uuid!) {
        update_workflow_runs_by_pk(
          pk_columns: { id: $id },
          _set: { status: running }
        ) { id }
      }
    `, { id: workflowRun.id });
    
    // Get existing step_runs for mapping
    const stepRunsQuery = gql`
      query GetStepRuns($workflowRunId: uuid!) {
        step_runs(where: { workflow_run_id: { _eq: $workflowRunId } }) {
          id
          step_id
        }
      }
    `;
    const stepRunsData = await client.request(stepRunsQuery, { 
      workflowRunId: workflowRun.id 
    });
    const stepRunMap = new Map(
      (stepRunsData as any).step_runs.map((sr: any) => [sr.step_id, sr.id])
    );

    // Continue executing remaining steps
    let currentInput = stepRun.output || workflowRun.input || {};
    let runStatus = 'completed';
    let runError: string | undefined;
    
    for (const step of remainingSteps) {
      const currentStepRunId = stepRunMap.get(step.id);
      
      await client.request(gql`
        mutation UpdateStepRunRunning($id: uuid!) {
          update_step_runs_by_pk(
            pk_columns: { id: $id },
            _set: { status: running, started_at: "${new Date().toISOString()}" }
          ) { id }
        }
      `, { id: currentStepRunId });
      
      const result = await executeStep(
        step.step_type as StepType,
        step.config as StepConfig,
        { ...currentInput, previous_output: currentInput },
        workflowRun.id,
        currentStepRunId!
      );
      
      if (result.shouldPause) {
        await client.request(gql`
          mutation PauseStep($id: uuid!, $output: jsonb) {
            update_step_runs_by_pk(
              pk_columns: { id: $id },
              _set: { status: awaiting_approval, output: $output }
            ) { id }
          }
        `, { id: currentStepRunId, output: result.output });
        
        await client.request(gql`
          mutation PauseRun($id: uuid!) {
            update_workflow_runs_by_pk(
              pk_columns: { id: $id },
              _set: { status: paused }
            ) { id }
          }
        `, { id: workflowRun.id });
        
        return res.json({
          success: true,
          message: `Step approved. Workflow paused at "${step.name}" awaiting approval`
        });
      }

      if (!result.success) {
        await client.request(gql`
          mutation FailStep($id: uuid!, $error: String, $output: jsonb) {
            update_step_runs_by_pk(
              pk_columns: { id: $id },
              _set: { 
                status: failed, 
                error: $error, 
                output: $output, 
                completed_at: "${new Date().toISOString()}" 
              }
            ) { id }
          }
        `, { id: currentStepRunId, error: result.error, output: result.output });
        
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
      `, { id: currentStepRunId, output: result.output });
      
      currentInput = result.output || currentInput;
    }
    
    // Finalize workflow run
    await client.request(gql`
      mutation FinalizeRun($id: uuid!, $status: run_status!, $output: jsonb, $error: String) {
        update_workflow_runs_by_pk(
          pk_columns: { id: $id },
          _set: { status: $status, output: $output, error: $error, completed_at: "${new Date().toISOString()}" }
        ) { id }
      }
    `, { id: workflowRun.id, status: runStatus, output: currentInput, error: runError });
    
    return res.json({
      success: true,
      message: runStatus === 'completed' 
        ? 'Step approved and workflow completed'
        : `Step approved but workflow ${runStatus}: ${runError}`
    });
    
  } catch (error: any) {
    console.error('Error approving step:', error);
    return res.json({ success: false, message: `Error: ${error.message}` });
  }
}
