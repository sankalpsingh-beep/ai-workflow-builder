'use client';

import { useQuery } from '@apollo/client';
import { GET_ORG_WITH_STATS } from '@/lib/graphql';
import { useAppStore } from '@/store/app-store';
import { BarChart3, Clock, Workflow, TrendingUp } from 'lucide-react';

export default function UsagePage() {
  const { currentOrg } = useAppStore();
  
  const { data, loading } = useQuery(GET_ORG_WITH_STATS, {
    variables: { orgId: currentOrg?.id },
    skip: !currentOrg?.id,
  });

  const org = data?.organizations_by_pk;
  const stats = org?.usage_stats;
  
  if (!currentOrg) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Select an organization first</p>
      </div>
    );
  }

  const quotaPercentage = org ? Math.round((org.quota_used / org.quota_limit) * 100) : 0;
  const daysUntilReset = org?.quota_reset_at 
    ? Math.ceil((new Date(org.quota_reset_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Usage & Quota</h1>

      {/* Quota Card */}
      <div className="bg-white rounded-lg border p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold">Monthly Quota</h2>
            <p className="text-sm text-gray-500">
              Resets in {daysUntilReset} days ({org?.quota_reset_at 
                ? new Date(org.quota_reset_at).toLocaleDateString() 
                : '-'})
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-gray-900">
              {org?.quota_used || 0}
              <span className="text-lg text-gray-500 font-normal"> / {org?.quota_limit || 0}</span>
            </p>
            <p className="text-sm text-gray-500">workflow runs</p>
          </div>
        </div>
        
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Usage</span>
            <span className={`font-medium ${
              quotaPercentage >= 90 ? 'text-red-600' : 
              quotaPercentage >= 70 ? 'text-yellow-600' : 'text-green-600'
            }`}>
              {quotaPercentage}%
            </span>
          </div>
          <div className="bg-gray-200 rounded-full h-4">
            <div 
              className={`h-4 rounded-full transition-all ${
                quotaPercentage >= 90 ? 'bg-red-500' : 
                quotaPercentage >= 70 ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(quotaPercentage, 100)}%` }}
            />
          </div>
        </div>
        
        {quotaPercentage >= 90 && (
          <div className="mt-4 p-3 bg-red-50 rounded-lg text-sm text-red-700">
            Your quota is almost exhausted. Workflow runs may fail once the limit is reached.
          </div>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Workflow className="w-5 h-5" />}
          label="Total Workflows"
          value={stats?.total_workflows || 0}
          color="blue"
        />
        <StatCard
          icon={<BarChart3 className="w-5 h-5" />}
          label="Total Runs"
          value={stats?.total_runs || 0}
          color="green"
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="Runs This Month"
          value={stats?.runs_this_month || 0}
          color="purple"
        />
        <StatCard
          icon={<Clock className="w-5 h-5" />}
          label="Avg Run Duration"
          value={stats?.avg_run_duration_seconds 
            ? `${Math.round(stats.avg_run_duration_seconds)}s` 
            : '-'}
          color="orange"
        />
      </div>

      {/* Usage Info */}
      <div className="bg-blue-50 rounded-lg p-6">
        <h3 className="font-semibold text-blue-900 mb-2">About Quotas</h3>
        <ul className="text-sm text-blue-800 space-y-2">
          <li>Each workflow run counts as 1 quota usage, regardless of the number of steps.</li>
          <li>Quota resets automatically every 30 days from when the organization was created.</li>
          <li>Failed runs and paused runs still count against your quota.</li>
          <li>Upgrade your plan to increase your monthly quota limit.</li>
        </ul>
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
