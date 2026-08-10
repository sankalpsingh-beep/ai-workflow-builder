'use client';

import { useState } from 'react';
import { StepType, StepConfig } from '@/types';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { useAppStore } from '@/store/app-store';
import { 
  Bot, Globe, Database, Bell, GitBranch, Shield,
  X, GripVertical, ChevronDown, ChevronUp
} from 'lucide-react';

interface StepEditorProps {
  step?: {
    id: string;
    name: string;
    step_type: StepType;
    step_order: number;
    config: StepConfig;
  };
  onSave: (data: { name: string; step_type: StepType; config: StepConfig }) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

const STEP_TYPE_INFO: Record<StepType, { label: string; icon: any; description: string; ownerOnly?: boolean }> = {
  llm_call: { label: 'LLM Call', icon: Bot, description: 'Call an AI model (GPT, Claude, etc.)' },
  http_request: { label: 'HTTP Request', icon: Globe, description: 'Make an API call to external service' },
  db_write: { label: 'Database Write', icon: Database, description: 'Save data to the database', ownerOnly: true },
  notify: { label: 'Notification', icon: Bell, description: 'Send a Slack/email notification', ownerOnly: true },
  conditional_branch: { label: 'Conditional Branch', icon: GitBranch, description: 'Branch based on conditions' },
  approval_gate: { label: 'Approval Gate', icon: Shield, description: 'Pause for human approval' },
};

export function StepEditor({ step, onSave, onCancel, onDelete }: StepEditorProps) {
  const { canAddRestrictedSteps } = useAppStore();
  const [name, setName] = useState(step?.name || '');
  const [stepType, setStepType] = useState<StepType>(step?.step_type || 'llm_call');
  const [config, setConfig] = useState<StepConfig>(step?.config || {});
  const [expanded, setExpanded] = useState(true);

  const handleSave = () => {
    onSave({ name, step_type: stepType, config });
  };

  const updateConfig = (key: string, value: any) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  // Filter step types based on permissions
  const availableStepTypes = Object.entries(STEP_TYPE_INFO)
    .filter(([type, info]) => !info.ownerOnly || canAddRestrictedSteps())
    .map(([value, info]) => ({ value, label: info.label }));

  return (
    <div className="bg-white rounded-lg border shadow-sm">
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-3">
          {step && <GripVertical className="w-4 h-4 text-gray-400 cursor-grab" />}
          <div className={`p-2 rounded-lg ${STEP_TYPE_INFO[stepType].ownerOnly ? 'bg-orange-50' : 'bg-blue-50'}`}>
            {(() => { const Icon = STEP_TYPE_INFO[stepType].icon; return <Icon className="w-4 h-4 text-blue-600" />; })()}
          </div>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Step name"
            className="border-0 font-medium focus:ring-0"
          />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setExpanded(!expanded)} className="p-1 hover:bg-gray-100 rounded">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {onDelete && (
            <button onClick={onDelete} className="p-1 hover:bg-red-50 text-red-500 rounded">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="p-4 space-y-4">
          <Select
            label="Step Type"
            value={stepType}
            onChange={(e) => {
              setStepType(e.target.value as StepType);
              setConfig({});
            }}
            options={availableStepTypes}
          />
          
          <p className="text-sm text-gray-500">
            {STEP_TYPE_INFO[stepType].description}
          </p>

          {/* Type-specific configuration */}
          {stepType === 'llm_call' && (
            <LLMCallConfig config={config} updateConfig={updateConfig} />
          )}
          
          {stepType === 'http_request' && (
            <HTTPRequestConfig config={config} updateConfig={updateConfig} />
          )}
          
          {stepType === 'db_write' && (
            <DBWriteConfig config={config} updateConfig={updateConfig} />
          )}
          
          {stepType === 'notify' && (
            <NotifyConfig config={config} updateConfig={updateConfig} />
          )}
          
          {stepType === 'conditional_branch' && (
            <ConditionalBranchConfig config={config} updateConfig={updateConfig} />
          )}
          
          {stepType === 'approval_gate' && (
            <ApprovalGateConfig config={config} updateConfig={updateConfig} />
          )}

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="secondary" onClick={onCancel}>Cancel</Button>
            <Button onClick={handleSave}>Save Step</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// LLM Call Configuration
function LLMCallConfig({ config, updateConfig }: { config: StepConfig; updateConfig: (k: string, v: any) => void }) {
  return (
    <div className="space-y-3">
      <Input
        label="System Prompt"
        value={config.system_prompt || ''}
        onChange={(e) => updateConfig('system_prompt', e.target.value)}
        placeholder="You are a helpful assistant..."
      />
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Prompt</label>
        <textarea
          value={config.prompt || ''}
          onChange={(e) => updateConfig('prompt', e.target.value)}
          placeholder="Use {{variable}} for dynamic values from previous steps"
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Model"
          value={config.model || 'llama-3.1-8b-instant'}
          onChange={(e) => updateConfig('model', e.target.value)}
          options={[
            { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (Fast)' },
            { value: 'llama-3.1-70b-versatile', label: 'Llama 3.1 70B' },
            { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
          ]}
        />
        <Input
          label="Max Tokens"
          type="number"
          value={config.max_tokens || 1024}
          onChange={(e) => updateConfig('max_tokens', parseInt(e.target.value))}
        />
      </div>
    </div>
  );
}


// HTTP Request Configuration
function HTTPRequestConfig({ config, updateConfig }: { config: StepConfig; updateConfig: (k: string, v: any) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-3">
        <Select
          label="Method"
          value={config.method || 'GET'}
          onChange={(e) => updateConfig('method', e.target.value)}
          options={[
            { value: 'GET', label: 'GET' },
            { value: 'POST', label: 'POST' },
            { value: 'PUT', label: 'PUT' },
            { value: 'DELETE', label: 'DELETE' },
          ]}
        />
        <div className="col-span-3">
          <Input
            label="URL"
            value={config.url || ''}
            onChange={(e) => updateConfig('url', e.target.value)}
            placeholder="https://api.example.com/endpoint"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Headers (JSON)</label>
        <textarea
          value={JSON.stringify(config.headers || {}, null, 2)}
          onChange={(e) => {
            try { updateConfig('headers', JSON.parse(e.target.value)); } catch {}
          }}
          rows={3}
          placeholder='{"Authorization": "Bearer {{token}}"}'
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      {config.method !== 'GET' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Body (JSON)</label>
          <textarea
            value={typeof config.body === 'string' ? config.body : JSON.stringify(config.body || {}, null, 2)}
            onChange={(e) => updateConfig('body', e.target.value)}
            rows={4}
            placeholder='{"key": "{{value}}"}'
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}
    </div>
  );
}

// DB Write Configuration  
function DBWriteConfig({ config, updateConfig }: { config: StepConfig; updateConfig: (k: string, v: any) => void }) {
  return (
    <div className="space-y-3">
      <Input
        label="Log Type"
        value={config.table || ''}
        onChange={(e) => updateConfig('table', e.target.value)}
        placeholder="custom_log"
      />
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Data (JSON)</label>
        <textarea
          value={typeof config.data === 'string' ? config.data : JSON.stringify(config.data || {}, null, 2)}
          onChange={(e) => {
            try { updateConfig('data', JSON.parse(e.target.value)); } catch { updateConfig('data', e.target.value); }
          }}
          rows={4}
          placeholder='{"result": "{{previous_output}}"}'
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <p className="text-sm text-yellow-600 bg-yellow-50 p-2 rounded">
        Note: Only owners can add this step type. Data will be stored in workflow_logs.
      </p>
    </div>
  );
}

// Notify Configuration
function NotifyConfig({ config, updateConfig }: { config: StepConfig; updateConfig: (k: string, v: any) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Channel"
          value={config.channel || 'slack'}
          onChange={(e) => updateConfig('channel', e.target.value)}
          options={[
            { value: 'slack', label: 'Slack' },
            { value: 'email', label: 'Email' },
          ]}
        />
        <Input
          label="Recipient"
          value={config.recipient || ''}
          onChange={(e) => updateConfig('recipient', e.target.value)}
          placeholder={config.channel === 'email' ? 'user@example.com' : '#channel'}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Message Template</label>
        <textarea
          value={config.message_template || ''}
          onChange={(e) => updateConfig('message_template', e.target.value)}
          rows={3}
          placeholder="Workflow completed with result: {{response}}"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
    </div>
  );
}


// Conditional Branch Configuration
function ConditionalBranchConfig({ config, updateConfig }: { config: StepConfig; updateConfig: (k: string, v: any) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Condition</label>
        <Input
          value={config.condition || ''}
          onChange={(e) => updateConfig('condition', e.target.value)}
          placeholder='response contains "success"'
        />
        <p className="text-xs text-gray-500 mt-1">
          Supported: &quot;field contains &quot;value&quot;&quot;, &quot;field equals &quot;value&quot;&quot;, &quot;field &gt; number&quot;
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="If True, Go to Step #"
          type="number"
          value={config.true_next_step ?? ''}
          onChange={(e) => updateConfig('true_next_step', e.target.value ? parseInt(e.target.value) : undefined)}
          placeholder="Next step order"
        />
        <Input
          label="If False, Go to Step #"
          type="number"
          value={config.false_next_step ?? ''}
          onChange={(e) => updateConfig('false_next_step', e.target.value ? parseInt(e.target.value) : undefined)}
          placeholder="Next step order"
        />
      </div>
    </div>
  );
}

// Approval Gate Configuration
function ApprovalGateConfig({ config, updateConfig }: { config: StepConfig; updateConfig: (k: string, v: any) => void }) {
  return (
    <div className="space-y-3">
      <Select
        label="Required Role to Approve"
        value={config.required_role || 'editor'}
        onChange={(e) => updateConfig('required_role', e.target.value)}
        options={[
          { value: 'editor', label: 'Editor or Owner' },
          { value: 'owner', label: 'Owner Only' },
        ]}
      />
      <Input
        label="Timeout (hours)"
        type="number"
        value={config.timeout_hours || 24}
        onChange={(e) => updateConfig('timeout_hours', parseInt(e.target.value))}
      />
      <p className="text-sm text-blue-600 bg-blue-50 p-2 rounded">
        Workflow will pause at this step until someone with the required role approves it.
      </p>
    </div>
  );
}
