// ============================================================
// Shared Types — AI Receptionist
// ============================================================

export type LLMProvider = 'deepseek' | 'anthropic' | 'openai';

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatRequest {
  messages: Message[];
  provider?: LLMProvider;
  sessionId: string;
  stream?: boolean;
}

export interface ChatResponse {
  reply: string;
  provider: LLMProvider;
  model: string;
  tokensUsed?: number;
  contextChunks?: number;
  latencyMs?: number;
}

export interface KnowledgeChunk {
  id: string;
  content: string;
  source: string;
  metadata: Record<string, string>;
  score?: number;
}

export interface IngestRequest {
  content: string;
  source: string;
  metadata?: Record<string, string>;
}

export interface IngestResponse {
  success: boolean;
  chunksCreated: number;
  source: string;
}

export interface ProviderConfig {
  name: LLMProvider;
  model: string;
  baseUrl: string;
  maxTokens: number;
  temperature: number;
}

export interface RAGResult {
  chunks: KnowledgeChunk[];
  contextText: string;
  tokenEstimate: number;
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  providers: Record<LLMProvider, boolean>;
  vectorDb: boolean;
  uptime: number;
  timestamp: string;
}

export interface ApiError {
  error: string;
  code: string;
  statusCode: number;
}
