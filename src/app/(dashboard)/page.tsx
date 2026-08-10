'use client';

import { useQuery } from '@apollo/client';
import { GET_ORG_WITH_STATS, GET_WORKFLOWS } from '@/lib/graphql';
import { useAppStore } from '@/store/app-store';
import { Workflow, BarChart3, Users, Clock, TrendingUp } from 'lucide-react';
import Link from 'next/link';

export default function DashboardPage() {
  const { currentOrg } = useAppStore();
  
  const { data: orgData, loading: orgLoading } = useQuery(GET_ORG_WITH_STATS, {
    variables: { orgId: currentOrg?.id },
    skip: !currentOrg?.id,
  });

  const { data: workflowsData, loading: workflowsLoading } = useQuery(GET_WORKFLOWS, {
    variables: { orgId: currentOrg?.id },
    skip: !currentOrg?.id,
  });

  if (!currentOrg) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <h2 className="text-xl font-semibold text-gray-700 mb-4">No Organization Selected</h2>
        <p className="text-gray-500 mb-6">Create or select an organization to get started.</p>
        <Link 
          href="/organizations/new"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Create Organization
        </Link>
      </div>
    );
  }

  const org = orgData?.organizations_by_pk;
  const workflows = workflowsData?.workflows || [];
  const stats = org?.usage_stats;

  const quotaPercentage = org ? Math.round((org.quota_used / org.quota_limit) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <Link
          href="/workflows/new"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + New Workflow
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Workflow className="w-5 h-5" />}
          label="Total Workflows"
          value={stats?.total_workflows || 0}
          color="blue"
        />
        <StatCard
          icon={<BarChart3 className="w-5 h-5" />}
          label="Runs This Month"
          value={stats?.runs_this_month || 0}
          color="green"
        />
        <StatCard
          icon={<Clock className="w-5 h-5" />}
          label="Avg Run Duration"
          value={stats?.avg_run_duration_seconds 
            ? `${Math.round(stats.avg_run_duration_seconds)}s` 
            : '-'}
          color="purple"
        />
        <StatCard
          icon={<Users className="w-5 h-5" />}
          label="Team Members"
          value={org?.members?.length || 0}
          color="orange"
        />
      </div>

      {/* Quota Usage */}
      <div className="bg-white rounded-lg border p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">Quota Usage</h3>
          <span className="text-sm text-gray-500">
            Resets on {org?.quota_reset_at 
              ? new Date(org.quota_reset_at).toLocaleDateString() 
              : '-'}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex-1 bg-gray-200 rounded-full h-3">
            <div 
              className={`h-3 rounded-full ${
                quotaPercentage >= 90 ? 'bg-red-500' : 
                quotaPercentage >= 70 ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(quotaPercentage, 100)}%` }}
            />
          </div>
          <span className="text-sm font-medium">
            {org?.quota_used || 0} / {org?.quota_limit || 0} runs
          </span>
        </div>
      </div>

      {/* Recent Workflows */}
      <div className="bg-white rounded-lg border">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Recent Workflows</h3>
          <Link href="/workflows" className="text-sm text-blue-600 hover:underline">
            View all
          </Link>
        </div>
        <div className="divide-y">
          {workflows.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              No workflows yet. Create your first workflow to get started.
            </div>
          ) : (
            workflows.slice(0, 5).map((workflow: any) => (
              <Link
                key={workflow.id}
                href={`/workflows/${workflow.id}`}
                className="flex items-center justify-between px-6 py-4 hover:bg-gray-50"
              >
                <div>
                  <h4 className="font-medium text-gray-900">{workflow.name}</h4>
                  <p className="text-sm text-gray-500">
                    {workflow.steps_aggregate?.aggregate?.count || 0} steps
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {workflow.runs?.[0] && (
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      workflow.runs[0].status === 'completed' ? 'bg-green-100 text-green-700' :
                      workflow.runs[0].status === 'failed' ? 'bg-red-100 text-red-700' :
                      workflow.runs[0].status === 'paused' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {workflow.runs[0].status}
                    </span>
                  )}
                  <span className={`w-2 h-2 rounded-full ${
                    workflow.is_active ? 'bg-green-500' : 'bg-gray-400'
                  }`} />
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ 
  icon, 
  label, 
  value, 
  color 
}: { 
  icon: React.ReactNode; 
  label: string; 
  value: number | string; 
  color: 'blue' | 'green' | 'purple' | 'orange';
}) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
    orange: 'bg-orange-50 text-orange-600',
  };

  return (
    <div className="bg-white rounded-lg border p-6">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${colors[color]}`}>
          {icon}
        </div>
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  );
}
