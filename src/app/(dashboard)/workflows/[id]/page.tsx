'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useSubscription } from '@apollo/client';
import { useParams, useRouter } from 'next/navigation';
import { 
  GET_WORKFLOW_DETAIL, 
  CREATE_STEP, 
  UPDATE_STEP, 
  DELETE_STEP,
  REORDER_STEPS,
  CREATE_TRIGGER,
  DELETE_TRIGGER,
  UPDATE_WORKFLOW,
  TRIGGER_WORKFLOW_RUN,
  APPROVE_STEP,
  SUBSCRIBE_STEP_RUNS,
  GET_WORKFLOWS
} from '@/lib/graphql';
import { useAppStore } from '@/store/app-store';
import { Button } from '@/components/ui/Button';
import { StepEditor } from '@/components/workflow/StepEditor';
import { StepType, StepConfig, TriggerType, WorkflowStep, StepRun } from '@/types';
import { 
  Play, Plus, Settings, Trash2, Webhook, Clock, Database,
  CheckCircle, XCircle, Pause, Loader2, AlertCircle, GripVertical
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import Link from 'next/link';
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd';

export default function WorkflowDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { currentOrg, canEdit, canTrigger, canAddRestrictedSteps } = useAppStore();
  const [addingStep, setAddingStep] = useState(false);
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [showTriggers, setShowTriggers] = useState(false);
  
  const { data, loading, refetch } = useQuery(GET_WORKFLOW_DETAIL, {
    variables: { workflowId: id },
  });

  const { data: stepRunsData } = useSubscription(SUBSCRIBE_STEP_RUNS, {
    variables: { workflowRunId: activeRunId },
    skip: !activeRunId,
  });

  const [createStep] = useMutation(CREATE_STEP, { onCompleted: () => { refetch(); setAddingStep(false); }});
  const [updateStep] = useMutation(UPDATE_STEP, { onCompleted: () => { refetch(); setEditingStepId(null); }});
  const [deleteStep] = useMutation(DELETE_STEP, { onCompleted: () => refetch() });
  const [reorderSteps] = useMutation(REORDER_STEPS, { onCompleted: () => refetch() });
  const [createTrigger] = useMutation(CREATE_TRIGGER, { onCompleted: () => refetch() });
  const [deleteTrigger] = useMutation(DELETE_TRIGGER, { onCompleted: () => refetch() });
  const [updateWorkflow] = useMutation(UPDATE_WORKFLOW, { 
    refetchQueries: [{ query: GET_WORKFLOWS, variables: { orgId: currentOrg?.id } }]
  });
  const [triggerRun, { loading: triggeringRun }] = useMutation(TRIGGER_WORKFLOW_RUN);
  const [approveStepMutation, { loading: approvingStep }] = useMutation(APPROVE_STEP);

  const workflow = data?.workflows_by_pk;
  const steps = workflow?.steps || [];
  const triggers = workflow?.triggers || [];
  const runs = workflow?.runs || [];
  const liveStepRuns = stepRunsData?.step_runs || [];

  const handleCreateStep = async (data: { name: string; step_type: StepType; config: StepConfig }) => {
    const maxOrder = Math.max(0, ...steps.map((s: any) => s.step_order));
    await createStep({
      variables: {
        workflowId: id,
        name: data.name,
        stepType: data.step_type,
        stepOrder: maxOrder + 1,
        config: data.config,
      },
    });
  };

  const handleUpdateStep = async (stepId: string, data: { name: string; step_type: StepType; config: StepConfig }) => {
    await updateStep({
      variables: {
        id: stepId,
        name: data.name,
        stepType: data.step_type,
        config: data.config,
      },
    });
  };

  const handleDeleteStep = async (stepId: string) => {
    if (confirm('Delete this step?')) {
      await deleteStep({ variables: { id: stepId } });
    }
  };

  // Handle drag and drop reordering
  const handleDragEnd = useCallback(async (result: DropResult) => {
    if (!result.destination || !canEdit()) return;
    
    const sourceIndex = result.source.index;
    const destIndex = result.destination.index;
    
    if (sourceIndex === destIndex) return;
    
    // Reorder the steps array locally
    const reorderedSteps = Array.from(steps) as WorkflowStep[];
    const [movedStep] = reorderedSteps.splice(sourceIndex, 1);
    reorderedSteps.splice(destIndex, 0, movedStep);
    
    // Build the updates array for the mutation
    const updates = reorderedSteps.map((step: WorkflowStep, index: number) => ({
      where: { id: { _eq: step.id } },
      _set: { step_order: index + 1 }
    }));
    
    try {
      await reorderSteps({ variables: { updates } });
    } catch (error: any) {
      console.error('Reorder failed:', error);
      alert(`Failed to reorder: ${error.message}`);
    }
  }, [steps, canEdit, reorderSteps]);

  const handleTriggerRun = async () => {
    try {
      const { data: result } = await triggerRun({
        variables: { workflowId: id, input: {} },
      });
      if (result.triggerWorkflowRun.success) {
        setActiveRunId(result.triggerWorkflowRun.workflow_run_id);
        refetch();
      } else {
        alert(result.triggerWorkflowRun.message);
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    }
  };

  const handleApproveStep = async (stepRunId: string) => {
    try {
      const { data: result } = await approveStepMutation({
        variables: { stepRunId },
      });
      if (!result.approveStep.success) {
        alert(result.approveStep.message);
      }
      refetch();
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    }
  };

  const handleAddTrigger = async (triggerType: TriggerType) => {
    const config: any = {};
    let webhookSecret: string | undefined;
    
    if (triggerType === 'webhook') {
      webhookSecret = uuidv4();
      config.description = 'Webhook trigger';
    } else if (triggerType === 'scheduled') {
      config.cron = '0 * * * *'; // Every hour
    } else if (triggerType === 'database_event') {
      config.table = 'workflow_logs';
      config.operation = 'INSERT';
    }
    
    await createTrigger({
      variables: {
        workflowId: id,
        triggerType,
        config,
        webhookSecret,
      },
    });
    setShowTriggers(false);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Workflow not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{workflow.name}</h1>
          <p className="text-gray-500">{workflow.description || 'No description'}</p>
        </div>
        <div className="flex items-center gap-3">
          {canTrigger() && (
            <Button 
              onClick={handleTriggerRun} 
              loading={triggeringRun}
              disabled={steps.length === 0}
            >
              <Play className="w-4 h-4 mr-2" />
              Run Workflow
            </Button>
          )}
          {canEdit() && (
            <Button variant="secondary" onClick={() => setShowTriggers(!showTriggers)}>
              <Settings className="w-4 h-4 mr-2" />
              Triggers
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Steps Builder */}
        <div className="col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Workflow Steps</h2>
            {canEdit() && (
              <Button variant="secondary" size="sm" onClick={() => setAddingStep(true)}>
                <Plus className="w-4 h-4 mr-1" />
                Add Step
              </Button>
            )}
          </div>

          {steps.length === 0 && !addingStep ? (
            <div className="bg-gray-50 border-2 border-dashed rounded-lg p-12 text-center">
              <p className="text-gray-500 mb-4">No steps yet. Add your first step to get started.</p>
              {canEdit() && (
                <Button onClick={() => setAddingStep(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add First Step
                </Button>
              )}
            </div>
          ) : (
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="steps">
                {(provided) => (
                  <div 
                    className="space-y-3"
                    {...provided.droppableProps}
                    ref={provided.innerRef}
                  >
                    {steps.map((step: WorkflowStep, index: number) => {
                      const stepRun = liveStepRuns.find((sr: StepRun) => sr.step?.id === step.id);
                      const isEditing = editingStepId === step.id;
                      
                      if (isEditing) {
                        return (
                          <StepEditor
                            key={step.id}
                            step={step}
                            onSave={(data) => handleUpdateStep(step.id, data)}
                            onCancel={() => setEditingStepId(null)}
                            onDelete={() => handleDeleteStep(step.id)}
                          />
                        );
                      }
                      
                      return (
                        <Draggable 
                          key={step.id} 
                          draggableId={step.id} 
                          index={index}
                          isDragDisabled={!canEdit() || !!activeRunId}
                        >
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                            >
                              <StepCard 
                                step={step}
                                stepRun={stepRun}
                                index={index}
                                canEdit={canEdit()}
                                onEdit={() => setEditingStepId(step.id)}
                                onDelete={() => handleDeleteStep(step.id)}
                                onApprove={() => stepRun && handleApproveStep(stepRun.id)}
                                approving={approvingStep}
                                dragHandleProps={provided.dragHandleProps}
                                isDragging={snapshot.isDragging}
                              />
                            </div>
                          )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}
                    
                    {addingStep && (
                      <StepEditor
                        onSave={handleCreateStep}
                        onCancel={() => setAddingStep(false)}
                      />
                    )}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          )}
        </div>

        {/* Sidebar - Triggers & Runs */}
        <div className="space-y-6">
          {/* Triggers */}
          {showTriggers && (
            <div className="bg-white rounded-lg border p-4">
              <h3 className="font-semibold mb-4">Triggers</h3>
              
              <div className="space-y-2 mb-4">
                {triggers.length === 0 ? (
                  <p className="text-sm text-gray-500">No triggers configured</p>
                ) : (
                  triggers.map((trigger: any) => (
                    <div key={trigger.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                      <div className="flex items-center gap-2">
                        {trigger.trigger_type === 'webhook' && <Webhook className="w-4 h-4 text-purple-500" />}
                        {trigger.trigger_type === 'scheduled' && <Clock className="w-4 h-4 text-blue-500" />}
                        {trigger.trigger_type === 'database_event' && <Database className="w-4 h-4 text-green-500" />}
                        <div>
                          <span className="text-sm font-medium capitalize">{trigger.trigger_type.replace('_', ' ')}</span>
                          {trigger.trigger_type === 'webhook' && (
                            <p className="text-xs text-gray-500 truncate max-w-32" title={trigger.webhook_secret}>
                              Secret: {trigger.webhook_secret?.slice(0, 8)}...
                            </p>
                          )}
                          {trigger.trigger_type === 'scheduled' && (
                            <p className="text-xs text-gray-500">Cron: {trigger.config?.cron}</p>
                          )}
                        </div>
                      </div>
                      <button 
                        onClick={() => deleteTrigger({ variables: { id: trigger.id } })}
                        className="p-1 hover:bg-red-50 text-red-500 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
              
              {canAddRestrictedSteps() && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500">Add trigger:</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => handleAddTrigger('webhook')}>
                      <Webhook className="w-3 h-3 mr-1" /> Webhook
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => handleAddTrigger('scheduled')}>
                      <Clock className="w-3 h-3 mr-1" /> Scheduled
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => handleAddTrigger('database_event')}>
                      <Database className="w-3 h-3 mr-1" /> DB Event
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Recent Runs */}
          <div className="bg-white rounded-lg border p-4">
            <h3 className="font-semibold mb-4">Recent Runs</h3>
            
            {runs.length === 0 ? (
              <p className="text-sm text-gray-500">No runs yet</p>
            ) : (
              <div className="space-y-2">
                {runs.map((run: any) => (
                  <button
                    key={run.id}
                    onClick={() => setActiveRunId(run.id)}
                    className={`w-full text-left p-2 rounded hover:bg-gray-50 ${
                      activeRunId === run.id ? 'bg-blue-50 border border-blue-200' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <RunStatusBadge status={run.status} />
                      <span className="text-xs text-gray-500">
                        {new Date(run.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 capitalize">
                      {run.trigger_type} trigger
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


// Step Card Component
function StepCard({ 
  step, 
  stepRun, 
  index, 
  canEdit, 
  onEdit, 
  onDelete,
  onApprove,
  approving,
  dragHandleProps,
  isDragging
}: { 
  step: WorkflowStep; 
  stepRun?: StepRun;
  index: number;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onApprove: () => void;
  approving: boolean;
  dragHandleProps?: any;
  isDragging?: boolean;
}) {
  const statusColors = {
    pending: 'bg-gray-100 text-gray-600',
    running: 'bg-blue-100 text-blue-600',
    awaiting_approval: 'bg-yellow-100 text-yellow-600',
    completed: 'bg-green-100 text-green-600',
    failed: 'bg-red-100 text-red-600',
    skipped: 'bg-gray-100 text-gray-400',
  };

  return (
    <div className={`bg-white rounded-lg border p-4 ${
      isDragging ? 'shadow-lg border-blue-400' :
      stepRun?.status === 'running' ? 'border-blue-400 shadow-sm' :
      stepRun?.status === 'awaiting_approval' ? 'border-yellow-400 shadow-sm' : ''
    }`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {canEdit && dragHandleProps && (
            <div 
              {...dragHandleProps}
              className="cursor-grab hover:bg-gray-100 p-1 rounded -ml-1"
            >
              <GripVertical className="w-4 h-4 text-gray-400" />
            </div>
          )}
          <span className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center text-sm font-medium">
            {index + 1}
          </span>
          <div>
            <h4 className="font-medium">{step.name}</h4>
            <p className="text-sm text-gray-500 capitalize">{step.step_type.replace('_', ' ')}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {stepRun && (
            <span className={`px-2 py-1 rounded-full text-xs ${statusColors[stepRun.status]}`}>
              {stepRun.status === 'running' && <Loader2 className="w-3 h-3 inline mr-1 animate-spin" />}
              {stepRun.status.replace('_', ' ')}
            </span>
          )}
          
          {stepRun?.status === 'awaiting_approval' && (
            <Button size="sm" onClick={onApprove} loading={approving}>
              Approve
            </Button>
          )}
          
          {canEdit && !stepRun && (
            <>
              <button onClick={onEdit} className="p-1 hover:bg-gray-100 rounded text-gray-500">
                <Settings className="w-4 h-4" />
              </button>
              <button onClick={onDelete} className="p-1 hover:bg-red-50 rounded text-red-500">
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>
      
      {/* Step Output */}
      {stepRun?.output && stepRun.status !== 'pending' && (
        <div className="mt-3 pt-3 border-t">
          <details className="text-sm">
            <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
              View Output
            </summary>
            <pre className="mt-2 p-2 bg-gray-50 rounded text-xs overflow-x-auto">
              {JSON.stringify(stepRun.output, null, 2)}
            </pre>
          </details>
        </div>
      )}
      
      {/* Error */}
      {stepRun?.error && (
        <div className="mt-3 pt-3 border-t">
          <div className="flex items-start gap-2 p-2 bg-red-50 rounded text-sm text-red-700">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{stepRun.error}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Run Status Badge
function RunStatusBadge({ status }: { status: string }) {
  const configs = {
    pending: { icon: <Pause className="w-3 h-3" />, className: 'bg-gray-100 text-gray-600' },
    running: { icon: <Loader2 className="w-3 h-3 animate-spin" />, className: 'bg-blue-100 text-blue-600' },
    paused: { icon: <Pause className="w-3 h-3" />, className: 'bg-yellow-100 text-yellow-600' },
    completed: { icon: <CheckCircle className="w-3 h-3" />, className: 'bg-green-100 text-green-600' },
    failed: { icon: <XCircle className="w-3 h-3" />, className: 'bg-red-100 text-red-600' },
    cancelled: { icon: <XCircle className="w-3 h-3" />, className: 'bg-gray-100 text-gray-600' },
  };
  
  const config = configs[status as keyof typeof configs] || configs.pending;
  
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs ${config.className}`}>
      {config.icon}
      {status}
    </span>
  );
}
