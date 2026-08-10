'use client';

import { useState } from 'react';
import { useMutation } from '@apollo/client';
import { useRouter } from 'next/navigation';
import { CREATE_WORKFLOW, GET_WORKFLOWS } from '@/lib/graphql';
import { useAppStore } from '@/store/app-store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export default function NewWorkflowPage() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const { currentOrg } = useAppStore();
  const router = useRouter();
  
  const [createWorkflow, { loading }] = useMutation(CREATE_WORKFLOW, {
    refetchQueries: [{ query: GET_WORKFLOWS, variables: { orgId: currentOrg?.id } }],
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const { data } = await createWorkflow({
        variables: {
          orgId: currentOrg?.id,
          name,
          description: description || null,
        },
      });
      
      router.push(`/workflows/${data.insert_workflows_one.id}`);
    } catch (error) {
      console.error('Error creating workflow:', error);
    }
  };

  if (!currentOrg) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Select an organization first</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Create New Workflow</h1>
      
      <div className="bg-white rounded-lg border p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Workflow Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., AI Content Generator"
            required
          />
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this workflow does..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.back()}
            >
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              Create Workflow
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
