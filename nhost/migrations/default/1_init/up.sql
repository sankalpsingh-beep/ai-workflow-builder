-- AI Agent Workflow Builder Schema
-- Organizations, Members, Workflows, Steps, Triggers, Runs

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Organizations table with usage quota
CREATE TABLE public.organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    quota_limit INTEGER DEFAULT 1000, -- max calls per period
    quota_used INTEGER DEFAULT 0,
    quota_reset_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Organization members with roles
CREATE TYPE public.org_role AS ENUM ('owner', 'editor', 'viewer');

CREATE TABLE public.org_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    role public.org_role NOT NULL DEFAULT 'viewer',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, org_id)
);

-- Workflows belonging to organizations
CREATE TABLE public.workflows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step types enum
CREATE TYPE public.step_type AS ENUM (
    'llm_call',
    'http_request', 
    'db_write',
    'notify',
    'conditional_branch',
    'approval_gate'
);

-- Workflow steps (ordered nodes in a workflow)
CREATE TABLE public.workflow_steps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    step_type public.step_type NOT NULL,
    step_order INTEGER NOT NULL,
    config JSONB DEFAULT '{}', -- type-specific configuration
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(workflow_id, step_order)
);

-- Trigger types enum
CREATE TYPE public.trigger_type AS ENUM (
    'manual',
    'webhook',
    'scheduled',
    'database_event'
);

-- Workflow triggers
CREATE TABLE public.workflow_triggers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    trigger_type public.trigger_type NOT NULL,
    config JSONB DEFAULT '{}', -- cron expression, webhook secret, event config, etc.
    is_active BOOLEAN DEFAULT true,
    webhook_secret VARCHAR(255), -- for webhook triggers
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Run status enum
CREATE TYPE public.run_status AS ENUM (
    'pending',
    'running',
    'paused',
    'completed',
    'failed',
    'cancelled'
);

-- Workflow runs (one per execution)
CREATE TABLE public.workflow_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    trigger_id UUID REFERENCES public.workflow_triggers(id),
    triggered_by UUID REFERENCES auth.users(id),
    trigger_type public.trigger_type NOT NULL,
    status public.run_status DEFAULT 'pending',
    input JSONB DEFAULT '{}',
    output JSONB DEFAULT '{}',
    error TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step run status enum
CREATE TYPE public.step_run_status AS ENUM (
    'pending',
    'running',
    'awaiting_approval',
    'completed',
    'failed',
    'skipped'
);

-- Step runs (one per step per run)
CREATE TABLE public.step_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_run_id UUID NOT NULL REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
    step_id UUID NOT NULL REFERENCES public.workflow_steps(id) ON DELETE CASCADE,
    status public.step_run_status DEFAULT 'pending',
    input JSONB DEFAULT '{}',
    output JSONB DEFAULT '{}',
    error TEXT,
    attempt_count INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    approved_by UUID REFERENCES auth.users(id),
    approved_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(workflow_run_id, step_id)
);

-- Workflow execution logs table (for db_write step type)
CREATE TABLE public.workflow_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_run_id UUID REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
    step_run_id UUID REFERENCES public.step_runs(id) ON DELETE CASCADE,
    log_type VARCHAR(50) NOT NULL,
    data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_org_members_user_id ON public.org_members(user_id);
CREATE INDEX idx_org_members_org_id ON public.org_members(org_id);
CREATE INDEX idx_workflows_org_id ON public.workflows(org_id);
CREATE INDEX idx_workflow_steps_workflow_id ON public.workflow_steps(workflow_id);
CREATE INDEX idx_workflow_triggers_workflow_id ON public.workflow_triggers(workflow_id);
CREATE INDEX idx_workflow_runs_workflow_id ON public.workflow_runs(workflow_id);
CREATE INDEX idx_workflow_runs_status ON public.workflow_runs(status);
CREATE INDEX idx_step_runs_workflow_run_id ON public.step_runs(workflow_run_id);
CREATE INDEX idx_step_runs_status ON public.step_runs(status);
CREATE INDEX idx_workflow_logs_workflow_run_id ON public.workflow_logs(workflow_run_id);

-- View for org-level usage statistics (aggregation requirement)
CREATE VIEW public.org_usage_stats AS
SELECT 
    o.id as org_id,
    o.name as org_name,
    o.quota_limit,
    o.quota_used,
    o.quota_reset_at,
    COUNT(DISTINCT w.id) as total_workflows,
    COUNT(DISTINCT wr.id) as total_runs,
    COUNT(DISTINCT CASE WHEN wr.created_at >= DATE_TRUNC('month', NOW()) THEN wr.id END) as runs_this_month,
    AVG(EXTRACT(EPOCH FROM (wr.completed_at - wr.started_at))) as avg_run_duration_seconds
FROM public.organizations o
LEFT JOIN public.workflows w ON w.org_id = o.id
LEFT JOIN public.workflow_runs wr ON wr.workflow_id = w.id
GROUP BY o.id, o.name, o.quota_limit, o.quota_used, o.quota_reset_at;

-- Function to get user's role in an org
CREATE OR REPLACE FUNCTION public.get_user_org_role(p_user_id UUID, p_org_id UUID)
RETURNS public.org_role AS $$
DECLARE
    v_role public.org_role;
BEGIN
    SELECT role INTO v_role
    FROM public.org_members
    WHERE user_id = p_user_id AND org_id = p_org_id;
    
    RETURN v_role;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to check if user has minimum role level
CREATE OR REPLACE FUNCTION public.user_has_role(p_user_id UUID, p_org_id UUID, p_min_role public.org_role)
RETURNS BOOLEAN AS $$
DECLARE
    v_role public.org_role;
BEGIN
    SELECT role INTO v_role
    FROM public.org_members
    WHERE user_id = p_user_id AND org_id = p_org_id;
    
    IF v_role IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Role hierarchy: owner > editor > viewer
    IF p_min_role = 'viewer' THEN
        RETURN TRUE;
    ELSIF p_min_role = 'editor' THEN
        RETURN v_role IN ('owner', 'editor');
    ELSIF p_min_role = 'owner' THEN
        RETURN v_role = 'owner';
    END IF;
    
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to all tables
CREATE TRIGGER update_organizations_updated_at
    BEFORE UPDATE ON public.organizations
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_org_members_updated_at
    BEFORE UPDATE ON public.org_members
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_workflows_updated_at
    BEFORE UPDATE ON public.workflows
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_workflow_steps_updated_at
    BEFORE UPDATE ON public.workflow_steps
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_workflow_triggers_updated_at
    BEFORE UPDATE ON public.workflow_triggers
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_workflow_runs_updated_at
    BEFORE UPDATE ON public.workflow_runs
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_step_runs_updated_at
    BEFORE UPDATE ON public.step_runs
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Function to check org quota before allowing a run
CREATE OR REPLACE FUNCTION public.check_org_quota(p_org_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_quota_limit INTEGER;
    v_quota_used INTEGER;
    v_quota_reset_at TIMESTAMPTZ;
BEGIN
    SELECT quota_limit, quota_used, quota_reset_at
    INTO v_quota_limit, v_quota_used, v_quota_reset_at
    FROM public.organizations
    WHERE id = p_org_id;
    
    -- Reset quota if period has passed
    IF v_quota_reset_at <= NOW() THEN
        UPDATE public.organizations
        SET quota_used = 0, quota_reset_at = NOW() + INTERVAL '30 days'
        WHERE id = p_org_id;
        RETURN TRUE;
    END IF;
    
    RETURN v_quota_used < v_quota_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to increment org quota usage
CREATE OR REPLACE FUNCTION public.increment_org_quota(p_org_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE public.organizations
    SET quota_used = quota_used + 1
    WHERE id = p_org_id;
END;
$$ LANGUAGE plpgsql;
