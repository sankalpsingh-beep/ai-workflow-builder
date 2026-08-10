export type OrgRole = 'owner' | 'editor' | 'viewer';

export type StepType = 
  | 'llm_call' 
  | 'http_request' 
  | 'db_write' 
  | 'notify' 
  | 'conditional_branch' 
  | 'approval_gate';

export type TriggerType = 'manual' | 'webhook' | 'scheduled' | 'database_event';

export type RunStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type StepRunStatus = 'pending' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'skipped';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  quota_limit: number;
  quota_used: number;
  quota_reset_at: string;
  created_at: string;
  updated_at: string;
}

export interface OrgMember {
  id: string;
  user_id: string;
  org_id: string;
  role: OrgRole;
  organization?: Organization;
  user?: {
    id: string;
    email: string;
    displayName: string;
  };
}

export interface Workflow {
  id: string;
  org_id: string;
  name: string;
  description?: string;
  is_active: boolean;
  created_by?: string;
  created_at: string;
  updated_at: string;
  steps?: WorkflowStep[];
  triggers?: WorkflowTrigger[];
  runs?: WorkflowRun[];
}

export interface WorkflowStep {
  id: string;
  workflow_id: string;
  name: string;
  step_type: StepType;
  step_order: number;
  config: StepConfig;
  created_at: string;
  updated_at: string;
}

export interface StepConfig {
  // llm_call
  prompt?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  system_prompt?: string;
  
  // http_request
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  
  // db_write
  table?: string;
  data?: any;
  
  // notify
  channel?: 'slack' | 'email';
  recipient?: string;
  message_template?: string;
  
  // conditional_branch
  condition?: string;
  true_next_step?: number;
  false_next_step?: number;
  
  // approval_gate
  required_role?: 'owner' | 'editor';
  timeout_hours?: number;
}

export interface WorkflowTrigger {
  id: string;
  workflow_id: string;
  trigger_type: TriggerType;
  config: TriggerConfig;
  is_active: boolean;
  webhook_secret?: string;
  created_at: string;
  updated_at: string;
}

export interface TriggerConfig {
  // scheduled
  cron?: string;
  input?: any;
  
  // database_event
  table?: string;
  operation?: 'INSERT' | 'UPDATE' | 'DELETE';
  
  // webhook
  description?: string;
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  trigger_id?: string;
  triggered_by?: string;
  trigger_type: TriggerType;
  status: RunStatus;
  input: any;
  output: any;
  error?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
  step_runs?: StepRun[];
  workflow?: Workflow;
}

export interface StepRun {
  id: string;
  workflow_run_id: string;
  step_id: string;
  status: StepRunStatus;
  input: any;
  output: any;
  error?: string;
  attempt_count: number;
  max_attempts: number;
  approved_by?: string;
  approved_at?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
  step?: WorkflowStep;
}

export interface OrgUsageStats {
  org_id: string;
  org_name: string;
  quota_limit: number;
  quota_used: number;
  quota_reset_at: string;
  total_workflows: number;
  total_runs: number;
  runs_this_month: number;
  avg_run_duration_seconds: number;
}
