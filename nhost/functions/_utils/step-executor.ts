import { gql } from 'graphql-request';
import { getAdminClient } from './graphql-client';

// Step types
export type StepType = 'llm_call' | 'http_request' | 'db_write' | 'notify' | 'conditional_branch' | 'approval_gate';

export interface StepConfig {
  // llm_call config
  prompt?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  system_prompt?: string;
  
  // http_request config  
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  
  // db_write config
  table?: string;
  data?: any;
  
  // notify config
  channel?: 'slack' | 'email';
  recipient?: string;
  message_template?: string;
  
  // conditional_branch config
  condition?: string; // JSONPath or simple expression
  true_next_step?: number;
  false_next_step?: number;
  
  // approval_gate config
  required_role?: 'owner' | 'editor';
  timeout_hours?: number;
}

export interface StepRunResult {
  success: boolean;
  output: any;
  error?: string;
  shouldPause?: boolean;
  nextStepOrder?: number;
}

// LLM API call (using Groq free tier as default)
async function executeLLMCall(config: StepConfig, input: any): Promise<StepRunResult> {
  const apiKey = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;
  const baseUrl = process.env.GROQ_API_KEY 
    ? 'https://api.groq.com/openai/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
  
  // If no API key, use stubbed response with delay
  if (!apiKey) {
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
    return {
      success: true,
      output: {
        response: `[STUBBED LLM RESPONSE] Prompt: "${config.prompt}". Input: ${JSON.stringify(input)}. This is a simulated response for testing.`,
        model: 'stubbed',
        tokens_used: 0
      }
    };
  }

  try {
    // Build the prompt with input context
    const userPrompt = config.prompt?.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return input[key] || input?.previous_output?.[key] || '';
    }) || JSON.stringify(input);

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || 'llama-3.1-8b-instant',
        messages: [
          ...(config.system_prompt ? [{ role: 'system', content: config.system_prompt }] : []),
          { role: 'user', content: userPrompt }
        ],
        temperature: config.temperature || 0.7,
        max_tokens: config.max_tokens || 1024,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LLM API error: ${error}`);
    }

    const data = await response.json();
    return {
      success: true,
      output: {
        response: data.choices[0]?.message?.content || '',
        model: data.model,
        tokens_used: data.usage?.total_tokens || 0
      }
    };
  } catch (error: any) {
    return {
      success: false,
      output: null,
      error: error.message
    };
  }
}

// HTTP Request
async function executeHTTPRequest(config: StepConfig, input: any): Promise<StepRunResult> {
  try {
    // Replace template variables in URL and body
    let url = config.url || '';
    let body = config.body;
    
    url = url.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return input[key] || input?.previous_output?.[key] || '';
    });
    
    if (typeof body === 'string') {
      body = body.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        return input[key] || input?.previous_output?.[key] || '';
      });
    }

    const response = await fetch(url, {
      method: config.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
      ...(config.method !== 'GET' && body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    });

    const contentType = response.headers.get('content-type');
    let responseData;
    
    if (contentType?.includes('application/json')) {
      responseData = await response.json();
    } else {
      responseData = await response.text();
    }

    return {
      success: response.ok,
      output: {
        status: response.status,
        data: responseData
      },
      error: response.ok ? undefined : `HTTP ${response.status}: ${JSON.stringify(responseData)}`
    };
  } catch (error: any) {
    return {
      success: false,
      output: null,
      error: error.message
    };
  }
}

// DB Write (writes to workflow_logs table)
async function executeDBWrite(config: StepConfig, input: any, workflowRunId: string, stepRunId: string): Promise<StepRunResult> {
  const client = getAdminClient();
  
  try {
    const mutation = gql`
      mutation InsertWorkflowLog($object: workflow_logs_insert_input!) {
        insert_workflow_logs_one(object: $object) {
          id
          created_at
        }
      }
    `;
    
    const result = await client.request(mutation, {
      object: {
        workflow_run_id: workflowRunId,
        step_run_id: stepRunId,
        log_type: config.table || 'custom_log',
        data: config.data || input.previous_output || input
      }
    });
    
    return {
      success: true,
      output: {
        log_id: (result as any).insert_workflow_logs_one.id,
        logged_at: (result as any).insert_workflow_logs_one.created_at
      }
    };
  } catch (error: any) {
    return {
      success: false,
      output: null,
      error: error.message
    };
  }
}

// Notify (Slack/Email via event trigger - this creates an event)
async function executeNotify(config: StepConfig, input: any, workflowRunId: string, stepRunId: string): Promise<StepRunResult> {
  const client = getAdminClient();
  
  try {
    // Build message from template
    let message = config.message_template || 'Workflow notification';
    message = message.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return input[key] || input?.previous_output?.[key] || '';
    });
    
    // Insert into workflow_logs with type 'notification' - this can trigger an event
    const mutation = gql`
      mutation InsertNotificationLog($object: workflow_logs_insert_input!) {
        insert_workflow_logs_one(object: $object) {
          id
          created_at
        }
      }
    `;
    
    const result = await client.request(mutation, {
      object: {
        workflow_run_id: workflowRunId,
        step_run_id: stepRunId,
        log_type: 'notification',
        data: {
          channel: config.channel || 'slack',
          recipient: config.recipient,
          message: message,
          sent_at: new Date().toISOString()
        }
      }
    });
    
    // In production, you'd send actual Slack/email here
    // For now, we log it
    console.log(`[NOTIFY] ${config.channel}: ${message} -> ${config.recipient}`);
    
    return {
      success: true,
      output: {
        notification_sent: true,
        channel: config.channel,
        recipient: config.recipient,
        message: message
      }
    };
  } catch (error: any) {
    return {
      success: false,
      output: null,
      error: error.message
    };
  }
}

// Conditional Branch
function executeConditionalBranch(config: StepConfig, input: any): StepRunResult {
  try {
    const condition = config.condition || 'true';
    const previousOutput = input.previous_output || {};
    
    // Simple condition evaluation
    // Supports: contains, equals, gt, lt, exists
    let result = false;
    
    if (condition.includes('contains')) {
      const match = condition.match(/(\w+)\s+contains\s+"([^"]+)"/);
      if (match) {
        const [, field, value] = match;
        result = String(previousOutput[field] || previousOutput?.response || '').toLowerCase().includes(value.toLowerCase());
      }
    } else if (condition.includes('equals')) {
      const match = condition.match(/(\w+)\s+equals\s+"([^"]+)"/);
      if (match) {
        const [, field, value] = match;
        result = String(previousOutput[field] || '') === value;
      }
    } else if (condition.includes('>')) {
      const match = condition.match(/(\w+)\s*>\s*(\d+)/);
      if (match) {
        const [, field, value] = match;
        result = Number(previousOutput[field] || 0) > Number(value);
      }
    } else if (condition.includes('<')) {
      const match = condition.match(/(\w+)\s*<\s*(\d+)/);
      if (match) {
        const [, field, value] = match;
        result = Number(previousOutput[field] || 0) < Number(value);
      }
    } else if (condition === 'true') {
      result = true;
    } else if (condition === 'false') {
      result = false;
    } else {
      // Try to evaluate as boolean from previous output
      result = Boolean(previousOutput[condition]);
    }
    
    return {
      success: true,
      output: {
        condition: condition,
        evaluated_to: result,
        branch_taken: result ? 'true' : 'false'
      },
      nextStepOrder: result ? config.true_next_step : config.false_next_step
    };
  } catch (error: any) {
    return {
      success: false,
      output: null,
      error: error.message
    };
  }
}

// Approval Gate - pauses execution
function executeApprovalGate(config: StepConfig, input: any): StepRunResult {
  return {
    success: true,
    output: {
      requires_approval: true,
      required_role: config.required_role || 'editor',
      timeout_hours: config.timeout_hours || 24,
      waiting_since: new Date().toISOString()
    },
    shouldPause: true
  };
}

// Main executor function with retry logic
export async function executeStep(
  stepType: StepType,
  config: StepConfig,
  input: any,
  workflowRunId: string,
  stepRunId: string,
  maxAttempts: number = 3
): Promise<StepRunResult> {
  let lastError: string | undefined;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      let result: StepRunResult;
      
      switch (stepType) {
        case 'llm_call':
          result = await executeLLMCall(config, input);
          break;
        case 'http_request':
          result = await executeHTTPRequest(config, input);
          break;
        case 'db_write':
          result = await executeDBWrite(config, input, workflowRunId, stepRunId);
          break;
        case 'notify':
          result = await executeNotify(config, input, workflowRunId, stepRunId);
          break;
        case 'conditional_branch':
          result = executeConditionalBranch(config, input);
          break;
        case 'approval_gate':
          result = executeApprovalGate(config, input);
          break;
        default:
          result = { success: false, output: null, error: `Unknown step type: ${stepType}` };
      }
      
      if (result.success || result.shouldPause) {
        return result;
      }
      
      lastError = result.error;
      
      // Don't retry approval_gate or conditional_branch
      if (stepType === 'approval_gate' || stepType === 'conditional_branch') {
        return result;
      }
      
      // Wait before retry (exponential backoff)
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
      }
    } catch (error: any) {
      lastError = error.message;
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
      }
    }
  }
  
  return {
    success: false,
    output: null,
    error: `Failed after ${maxAttempts} attempts. Last error: ${lastError}`
  };
}
