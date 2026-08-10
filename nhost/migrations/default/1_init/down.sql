-- Rollback migration

DROP TRIGGER IF EXISTS update_step_runs_updated_at ON public.step_runs;
DROP TRIGGER IF EXISTS update_workflow_runs_updated_at ON public.workflow_runs;
DROP TRIGGER IF EXISTS update_workflow_triggers_updated_at ON public.workflow_triggers;
DROP TRIGGER IF EXISTS update_workflow_steps_updated_at ON public.workflow_steps;
DROP TRIGGER IF EXISTS update_workflows_updated_at ON public.workflows;
DROP TRIGGER IF EXISTS update_org_members_updated_at ON public.org_members;
DROP TRIGGER IF EXISTS update_organizations_updated_at ON public.organizations;

DROP FUNCTION IF EXISTS public.increment_org_quota;
DROP FUNCTION IF EXISTS public.check_org_quota;
DROP FUNCTION IF EXISTS public.update_updated_at_column;
DROP FUNCTION IF EXISTS public.user_has_role;
DROP FUNCTION IF EXISTS public.get_user_org_role;

DROP VIEW IF EXISTS public.org_usage_stats;

DROP TABLE IF EXISTS public.workflow_logs;
DROP TABLE IF EXISTS public.step_runs;
DROP TABLE IF EXISTS public.workflow_runs;
DROP TABLE IF EXISTS public.workflow_triggers;
DROP TABLE IF EXISTS public.workflow_steps;
DROP TABLE IF EXISTS public.workflows;
DROP TABLE IF EXISTS public.org_members;
DROP TABLE IF EXISTS public.organizations;

DROP TYPE IF EXISTS public.step_run_status;
DROP TYPE IF EXISTS public.run_status;
DROP TYPE IF EXISTS public.trigger_type;
DROP TYPE IF EXISTS public.step_type;
DROP TYPE IF EXISTS public.org_role;
