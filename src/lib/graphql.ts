import { gql } from '@apollo/client';

// Organization Queries
export const GET_USER_ORGS = gql`
  query GetUserOrgs {
    org_members {
      id
      role
      organization {
        id
        name
        slug
        quota_limit
        quota_used
        quota_reset_at
      }
    }
  }
`;

export const GET_ORG_WITH_STATS = gql`
  query GetOrgWithStats($orgId: uuid!) {
    organizations_by_pk(id: $orgId) {
      id
      name
      slug
      quota_limit
      quota_used
      quota_reset_at
      members {
        id
        role
        user {
          id
          email
          displayName
        }
      }
      usage_stats {
        total_workflows
        total_runs
        runs_this_month
        avg_run_duration_seconds
      }
    }
  }
`;

// Workflow Queries
export const GET_WORKFLOWS = gql`
  query GetWorkflows($orgId: uuid!) {
    workflows(
      where: { org_id: { _eq: $orgId } }
      order_by: { updated_at: desc }
    ) {
      id
      name
      description
      is_active
      created_at
      updated_at
      steps_aggregate {
        aggregate {
          count
        }
      }
      runs(limit: 1, order_by: { created_at: desc }) {
        id
        status
        created_at
      }
    }
  }
`;

export const GET_WORKFLOW_DETAIL = gql`
  query GetWorkflowDetail($workflowId: uuid!) {
    workflows_by_pk(id: $workflowId) {
      id
      name
      description
      is_active
      org_id
      created_at
      updated_at
      steps(order_by: { step_order: asc }) {
        id
        name
        step_type
        step_order
        config
      }
      triggers {
        id
        trigger_type
        config
        is_active
        webhook_secret
      }
      runs(limit: 10, order_by: { created_at: desc }) {
        id
        status
        trigger_type
        input
        output
        error
        started_at
        completed_at
        created_at
      }
    }
  }
`;


// Workflow Run Queries
export const GET_WORKFLOW_RUN = gql`
  query GetWorkflowRun($runId: uuid!) {
    workflow_runs_by_pk(id: $runId) {
      id
      status
      trigger_type
      input
      output
      error
      started_at
      completed_at
      workflow {
        id
        name
      }
      step_runs(order_by: { step: { step_order: asc } }) {
        id
        status
        input
        output
        error
        attempt_count
        approved_by
        approved_at
        started_at
        completed_at
        step {
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

// Real-time subscription for step runs
export const SUBSCRIBE_STEP_RUNS = gql`
  subscription SubscribeStepRuns($workflowRunId: uuid!) {
    step_runs(
      where: { workflow_run_id: { _eq: $workflowRunId } }
      order_by: { step: { step_order: asc } }
    ) {
      id
      status
      input
      output
      error
      attempt_count
      approved_by
      approved_at
      started_at
      completed_at
      step {
        id
        name
        step_type
        step_order
      }
    }
  }
`;

export const SUBSCRIBE_WORKFLOW_RUN = gql`
  subscription SubscribeWorkflowRun($runId: uuid!) {
    workflow_runs_by_pk(id: $runId) {
      id
      status
      output
      error
      completed_at
    }
  }
`;

// Mutations
export const CREATE_ORG = gql`
  mutation CreateOrg($name: String!, $slug: String!) {
    insert_organizations_one(object: { name: $name, slug: $slug }) {
      id
      name
      slug
    }
  }
`;

export const ADD_ORG_MEMBER = gql`
  mutation AddOrgMember($orgId: uuid!, $userId: uuid!, $role: org_role!) {
    insert_org_members_one(
      object: { org_id: $orgId, user_id: $userId, role: $role }
    ) {
      id
    }
  }
`;

export const CREATE_WORKFLOW = gql`
  mutation CreateWorkflow(
    $orgId: uuid!
    $name: String!
    $description: String
  ) {
    insert_workflows_one(
      object: { org_id: $orgId, name: $name, description: $description }
    ) {
      id
      name
    }
  }
`;

export const UPDATE_WORKFLOW = gql`
  mutation UpdateWorkflow(
    $id: uuid!
    $name: String
    $description: String
    $is_active: Boolean
  ) {
    update_workflows_by_pk(
      pk_columns: { id: $id }
      _set: { name: $name, description: $description, is_active: $is_active }
    ) {
      id
    }
  }
`;

export const DELETE_WORKFLOW = gql`
  mutation DeleteWorkflow($id: uuid!) {
    delete_workflows_by_pk(id: $id) {
      id
    }
  }
`;


// Step Mutations
export const CREATE_STEP = gql`
  mutation CreateStep(
    $workflowId: uuid!
    $name: String!
    $stepType: step_type!
    $stepOrder: Int!
    $config: jsonb
  ) {
    insert_workflow_steps_one(
      object: {
        workflow_id: $workflowId
        name: $name
        step_type: $stepType
        step_order: $stepOrder
        config: $config
      }
    ) {
      id
    }
  }
`;

export const UPDATE_STEP = gql`
  mutation UpdateStep(
    $id: uuid!
    $name: String
    $stepType: step_type
    $stepOrder: Int
    $config: jsonb
  ) {
    update_workflow_steps_by_pk(
      pk_columns: { id: $id }
      _set: {
        name: $name
        step_type: $stepType
        step_order: $stepOrder
        config: $config
      }
    ) {
      id
    }
  }
`;

export const DELETE_STEP = gql`
  mutation DeleteStep($id: uuid!) {
    delete_workflow_steps_by_pk(id: $id) {
      id
    }
  }
`;

export const REORDER_STEPS = gql`
  mutation ReorderSteps($updates: [workflow_steps_updates!]!) {
    update_workflow_steps_many(updates: $updates) {
      returning {
        id
        step_order
      }
    }
  }
`;

// Trigger Mutations
export const CREATE_TRIGGER = gql`
  mutation CreateTrigger(
    $workflowId: uuid!
    $triggerType: trigger_type!
    $config: jsonb
    $webhookSecret: String
  ) {
    insert_workflow_triggers_one(
      object: {
        workflow_id: $workflowId
        trigger_type: $triggerType
        config: $config
        webhook_secret: $webhookSecret
      }
    ) {
      id
      webhook_secret
    }
  }
`;

export const UPDATE_TRIGGER = gql`
  mutation UpdateTrigger(
    $id: uuid!
    $config: jsonb
    $isActive: Boolean
  ) {
    update_workflow_triggers_by_pk(
      pk_columns: { id: $id }
      _set: { config: $config, is_active: $isActive }
    ) {
      id
    }
  }
`;

export const DELETE_TRIGGER = gql`
  mutation DeleteTrigger($id: uuid!) {
    delete_workflow_triggers_by_pk(id: $id) {
      id
    }
  }
`;

// Action Mutations (Hasura Actions)
export const TRIGGER_WORKFLOW_RUN = gql`
  mutation TriggerWorkflowRun($workflowId: uuid!, $input: jsonb) {
    triggerWorkflowRun(workflow_id: $workflowId, input: $input) {
      success
      workflow_run_id
      message
    }
  }
`;

export const APPROVE_STEP = gql`
  mutation ApproveStep($stepRunId: uuid!) {
    approveStep(step_run_id: $stepRunId) {
      success
      message
    }
  }
`;

export const WEBHOOK_TRIGGER = gql`
  mutation WebhookTrigger(
    $workflowId: uuid!
    $webhookSecret: String!
    $payload: jsonb
  ) {
    webhookTrigger(
      workflow_id: $workflowId
      webhook_secret: $webhookSecret
      payload: $payload
    ) {
      success
      workflow_run_id
      message
    }
  }
`;
