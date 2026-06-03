export type LLMProvider = 'deepseek' | 'anthropic' | 'openai';
export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  provider?: LLMProvider;
  model?: string;
  tokensUsed?: number;
  contextChunks?: number;
  latencyMs?: number;
  isError?: boolean;
}

export interface ProviderInfo {
  id: LLMProvider;
  label: string;
  model: string;
  available: boolean;
  isDefault: boolean;
}

export interface HealthData {
  status: string;
  uptime: number;
  knowledgeChunks: number;
  sources: string[];
  providers: Record<LLMProvider, boolean>;
  defaultProvider: LLMProvider;
  timestamp: string;
}

export interface ChatStats {
  totalMessages: number;
  totalTokens: number;
  avgLatencyMs: number;
  contextHits: number;
}
