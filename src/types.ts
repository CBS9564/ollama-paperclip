export type TaskStatus = 'todo' | 'in-progress' | 'done' | 'failed';

export interface Agent {
  id: string;
  name: string;
  model: string;
  systemPrompt: string;
  color: string;
  temperature?: number;
  num_ctx?: number;
  isPending?: boolean;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  createdAt: number;
  completedAt?: number;
  agentId?: string; // ID of the agent assigned
  result?: string; // Output from the agent execution
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  id: string;
  timestamp: number;
  type?: 'text' | 'task-list' | 'agent-result';
  agentId?: string;
  taskId?: string;
  isSummary?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  tasks: Task[];
  agents: Agent[];
  model: string;
  createdAt: number;
  updatedAt: number;
}

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    format: string;
    family: string;
    families: string[] | null;
    parameter_size: string;
    quantization_level: string;
  };
}

export interface OllamaSettings {
  baseUrl: string;
  selectedModel: string;
  isAgentMode: boolean;
}

export interface PullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}
