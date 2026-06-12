/**
 * API client.
 *
 * Auth policy mirrors the backend:
 *   PUBLIC  — chat, providers, health  (no token sent)
 *   ADMIN   — knowledge ingest/stats   (Bearer token required, auto-refresh on 401)
 */

import { LLMProvider, ProviderInfo, HealthData } from '@/types';
import { getAccessToken, silentRefresh, clearAuth } from '@/lib/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── Authenticated fetch (with auto-refresh on 401) ────────────────────────

let _isRefreshing = false;

async function authedFetch<T>(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<T> {
  const token = getAccessToken();

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401 && retry && !_isRefreshing) {
    _isRefreshing = true;
    const ok = await silentRefresh();
    _isRefreshing = false;
    if (ok) return authedFetch<T>(path, options, false);
    clearAuth();
    throw new ApiError('Session expired — please log in again', 401, 'SESSION_EXPIRED');
  }

  if (!res.ok) {
    let body: { error?: string; code?: string; detail?: { error?: string; code?: string } } = {};
    try { body = await res.json(); } catch {}
    const msg  = body.detail?.error || body.error || `HTTP ${res.status}`;
    const code = body.detail?.code  || body.code  || 'API_ERROR';
    throw new ApiError(msg, res.status, code);
  }

  return res.json() as Promise<T>;
}

// ── Public fetch (no auth header) ────────────────────────────────────────────

async function publicFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });

  if (!res.ok) {
    let body: { error?: string; code?: string; detail?: { error?: string; code?: string } } = {};
    try { body = await res.json(); } catch {}
    const msg  = body.detail?.error || body.error || `HTTP ${res.status}`;
    const code = body.detail?.code  || body.code  || 'API_ERROR';
    throw new ApiError(msg, res.status, code);
  }

  return res.json() as Promise<T>;
}

// ── Chat (PUBLIC) ─────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatApiResponse {
  reply:         string;
  provider:      LLMProvider;
  model:         string;
  tokensUsed:    number;
  contextChunks: number;
  latencyMs:     number;
}

export async function sendChat(
  messages: ChatMessage[],
  sessionId: string,
  provider?: LLMProvider,
): Promise<ChatApiResponse> {
  return publicFetch<ChatApiResponse>('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages, sessionId, provider }),
  });
}

// ── Knowledge (ADMIN — authenticated) ────────────────────────────────────────

export interface IngestResponse {
  success:       boolean;
  chunksCreated: number;
  source:        string;
}

export async function ingestKnowledge(
  content: string,
  source: string,
  metadata?: Record<string, string>,
): Promise<IngestResponse> {
  return authedFetch<IngestResponse>('/api/knowledge', {
    method: 'POST',
    body: JSON.stringify({ content, source, metadata }),
  });
}

export interface KnowledgeStats {
  totalChunks: number;
  sources:     string[];
  indexReady:  boolean;
}

export async function getKnowledgeStats(): Promise<KnowledgeStats> {
  return authedFetch<KnowledgeStats>('/api/knowledge');
}

/**
 * Upload a file (.pdf, .docx, .txt, .md) for RAG ingestion. Admin only.
 *
 * Uses FormData/multipart — does NOT go through authedFetch because that
 * helper forces 'Content-Type: application/json', which would break the
 * browser's multipart boundary. Auth + 401 auto-refresh is reimplemented here.
 */
export async function uploadKnowledgeFile(file: File, retry = true): Promise<IngestResponse> {
  const token = getAccessToken();
  const form  = new FormData();
  form.append('file', file);

  const res = await fetch(`${API_URL}/api/knowledge/upload`, {
    method: 'POST',
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });

  if (res.status === 401 && retry) {
    const ok = await silentRefresh();
    if (ok) return uploadKnowledgeFile(file, false);
    clearAuth();
    throw new ApiError('Session expired — please log in again', 401, 'SESSION_EXPIRED');
  }

  if (!res.ok) {
    let body: { error?: string; code?: string; detail?: { error?: string; code?: string } } = {};
    try { body = await res.json(); } catch {}
    const msg  = body.detail?.error || body.error || `HTTP ${res.status}`;
    const code = body.detail?.code  || body.code  || 'API_ERROR';
    throw new ApiError(msg, res.status, code);
  }

  return res.json() as Promise<IngestResponse>;
}

export const SUPPORTED_UPLOAD_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'];
export const MAX_UPLOAD_SIZE_MB = 10;

// ── Providers (PUBLIC) ────────────────────────────────────────────────────────

export async function getProviders(): Promise<{ providers: ProviderInfo[]; default: LLMProvider }> {
  return publicFetch('/api/providers');
}

// ── Health (PUBLIC) ───────────────────────────────────────────────────────────

export async function getHealth(): Promise<HealthData> {
  return publicFetch<HealthData>('/api/health');
}
