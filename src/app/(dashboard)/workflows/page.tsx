'use client';

import { useQuery } from '@apollo/client';
import { GET_WORKFLOWS } from '@/lib/graphql';
import { useAppStore } from '@/store/app-store';
import { Workflow, Plus, MoreVertical } from 'lucide-react';
import Link from 'next/link';

export default function WorkflowsPage() {
  const { currentOrg, canEdit } = useAppStore();
  
  const { data, loading, error } = useQuery(GET_WORKFLOWS, {
    variables: { orgId: currentOrg?.id },
    skip: !currentOrg?.id,
  });

  const workflows = data?.workflows || [];

  if (!currentOrg) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Select an organization to view workflows</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Workflows</h1>
        {canEdit() && (
          <Link
            href="/workflows/new"
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            New Workflow
          </Link>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : workflows.length === 0 ? (
        <div className="bg-white rounded-lg border p-12 text-center">
          <Workflow className="w-12 h-12 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No workflows yet</h3>
          <p className="text-gray-500 mb-6">Create your first workflow to start automating AI agent tasks</p>
          {canEdit() && (
            <Link
              href="/workflows/new"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Plus className="w-4 h-4" />
              Create Workflow
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {workflows.map((workflow: any) => (
            <WorkflowCard key={workflow.id} workflow={workflow} />
          ))}
        </div>
      )}
    </div>
  );
}

function WorkflowCard({ workflow }: { workflow: any }) {
  const lastRun = workflow.runs?.[0];
  
  return (
    <Link
      href={`/workflows/${workflow.id}`}
      className="bg-white rounded-lg border p-6 hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-50 rounded-lg">
            <Workflow className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{workflow.name}</h3>
            <p className="text-sm text-gray-500">
              {workflow.steps_aggregate?.aggregate?.count || 0} steps
            </p>
          </div>
        </div>
        <span className={`w-2 h-2 rounded-full ${
          workflow.is_active ? 'bg-green-500' : 'bg-gray-400'
        }`} />
      </div>
      
      {workflow.description && (
        <p className="text-sm text-gray-600 mb-4 line-clamp-2">
          {workflow.description}
        </p>
      )}
      
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-500">
          Updated {new Date(workflow.updated_at).toLocaleDateString()}
        </span>
        {lastRun && (
          <span className={`px-2 py-1 rounded-full text-xs ${
            lastRun.status === 'completed' ? 'bg-green-100 text-green-700' :
            lastRun.status === 'failed' ? 'bg-red-100 text-red-700' :
            lastRun.status === 'paused' ? 'bg-yellow-100 text-yellow-700' :
            lastRun.status === 'running' ? 'bg-blue-100 text-blue-700' :
            'bg-gray-100 text-gray-700'
          }`}>
            {lastRun.status}
          </span>
        )}
      </div>
    </Link>
  );
}
