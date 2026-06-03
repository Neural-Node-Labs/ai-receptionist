import { LLMProvider, ProviderInfo, HealthData } from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || '';

class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      ...options.headers,
    },
  });

  if (!res.ok) {
    let body: { error?: string; code?: string } = {};
    try {
      body = await res.json();
    } catch {}
    throw new ApiError(
      body.error || `HTTP ${res.status}`,
      res.status,
      body.code || 'API_ERROR'
    );
  }

  return res.json() as Promise<T>;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatApiResponse {
  reply: string;
  provider: LLMProvider;
  model: string;
  tokensUsed: number;
  contextChunks: number;
  latencyMs: number;
}

export async function sendChat(
  messages: ChatMessage[],
  sessionId: string,
  provider?: LLMProvider
): Promise<ChatApiResponse> {
  return apiFetch<ChatApiResponse>('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages, sessionId, provider }),
  });
}

export interface IngestResponse {
  success: boolean;
  chunksCreated: number;
  source: string;
}

export async function ingestKnowledge(
  content: string,
  source: string,
  metadata?: Record<string, string>
): Promise<IngestResponse> {
  return apiFetch<IngestResponse>('/api/knowledge', {
    method: 'POST',
    body: JSON.stringify({ content, source, metadata }),
  });
}

export interface KnowledgeStats {
  totalChunks: number;
  sources: string[];
  indexReady: boolean;
}

export async function getKnowledgeStats(): Promise<KnowledgeStats> {
  return apiFetch<KnowledgeStats>('/api/knowledge');
}

export async function getHealth(): Promise<HealthData> {
  return apiFetch<HealthData>('/api/health');
}

export async function getProviders(): Promise<{ providers: ProviderInfo[]; default: LLMProvider }> {
  return apiFetch('/api/providers');
}
