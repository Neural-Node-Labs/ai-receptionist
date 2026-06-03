/**
 * LLM Provider Abstraction
 * Supports DeepSeek (default), Anthropic, OpenAI via unified schema adapters.
 * All providers use OpenAI-compatible /chat/completions format where possible.
 * Anthropic uses its native /messages API.
 */

import { LLMProvider, Message, ProviderConfig } from '@/types';
import { logger } from '@/lib/logger';

// ─── Provider Configurations ────────────────────────────────────────────────

const PROVIDER_CONFIGS: Record<LLMProvider, ProviderConfig> = {
  deepseek: {
    name: 'deepseek',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    maxTokens: 1024,
    temperature: 0.3,
  },
  openai: {
    name: 'openai',
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
    maxTokens: 1024,
    temperature: 0.3,
  },
  anthropic: {
    name: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    baseUrl: 'https://api.anthropic.com',
    maxTokens: 1024,
    temperature: 0.3,
  },
};

// ─── API Key Resolver ───────────────────────────────────────────────────────

function getApiKey(provider: LLMProvider): string {
  const keyMap: Record<LLMProvider, string | undefined> = {
    deepseek: process.env.DEEPSEEK_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
  };
  const key = keyMap[provider];
  if (!key) throw new Error(`API key not configured for provider: ${provider}`);
  return key;
}

// ─── OpenAI-compatible schema (DeepSeek + OpenAI) ──────────────────────────

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens: number;
  temperature: number;
  stream: false;
}

interface OpenAIResponse {
  choices: Array<{
    message: { content: string };
    finish_reason: string;
  }>;
  usage?: { total_tokens: number; prompt_tokens: number; completion_tokens: number };
  model: string;
}

async function callOpenAICompatible(
  config: ProviderConfig,
  apiKey: string,
  messages: Message[],
  systemPrompt: string
): Promise<{ content: string; tokensUsed: number }> {
  const body: OpenAIRequest = {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ],
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    stream: false,
  };

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error');
    throw new Error(`${config.name} API error ${res.status}: ${errText.slice(0, 256)}`);
  }

  const data: OpenAIResponse = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${config.name} returned empty response`);

  return { content, tokensUsed: data.usage?.total_tokens ?? 0 };
}

// ─── Anthropic native schema ────────────────────────────────────────────────

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  temperature: number;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
  usage?: { input_tokens: number; output_tokens: number };
  model: string;
}

async function callAnthropic(
  config: ProviderConfig,
  apiKey: string,
  messages: Message[],
  systemPrompt: string
): Promise<{ content: string; tokensUsed: number }> {
  // Anthropic does not accept system messages in the messages array
  const filteredMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const body: AnthropicRequest = {
    model: config.model,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    system: systemPrompt,
    messages: filteredMessages,
  };

  const res = await fetch(`${config.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error');
    throw new Error(`Anthropic API error ${res.status}: ${errText.slice(0, 256)}`);
  }

  const data: AnthropicResponse = await res.json();
  const textBlock = data.content?.find((b) => b.type === 'text');
  if (!textBlock?.text) throw new Error('Anthropic returned empty response');

  const tokensUsed = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);
  return { content: textBlock.text, tokensUsed };
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function getProviderConfig(provider: LLMProvider): ProviderConfig {
  return PROVIDER_CONFIGS[provider];
}

export function getDefaultProvider(): LLMProvider {
  const env = process.env.DEFAULT_LLM_PROVIDER as LLMProvider | undefined;
  if (env && env in PROVIDER_CONFIGS) return env;
  return 'deepseek';
}

export async function callLLM(
  provider: LLMProvider,
  messages: Message[],
  systemPrompt: string
): Promise<{ content: string; tokensUsed: number; model: string }> {
  const config = PROVIDER_CONFIGS[provider];
  const apiKey = getApiKey(provider);

  const start = Date.now();

  let result: { content: string; tokensUsed: number };

  if (provider === 'anthropic') {
    result = await callAnthropic(config, apiKey, messages, systemPrompt);
  } else {
    result = await callOpenAICompatible(config, apiKey, messages, systemPrompt);
  }

  logger.info({
    msg: 'LLM call complete',
    provider,
    model: config.model,
    tokensUsed: result.tokensUsed,
    latencyMs: Date.now() - start,
    messageCount: messages.length,
  });

  return { ...result, model: config.model };
}

export async function checkProviderHealth(provider: LLMProvider): Promise<boolean> {
  try {
    await callLLM(provider, [{ role: 'user', content: 'ping' }], 'Reply with: pong');
    return true;
  } catch {
    return false;
  }
}
