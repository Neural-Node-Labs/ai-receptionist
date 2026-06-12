'use client';

import { useState, useCallback, useRef } from 'react';
import { Message, LLMProvider, ChatStats } from '@/types';
import { sendChat, ChatMessage } from '@/lib/api';

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const SESSION_ID  = generateId();
const MAX_HISTORY = 10;

export function useChat(defaultProvider: LLMProvider = 'deepseek') {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [provider, setProvider]   = useState<LLMProvider>(defaultProvider);
  const [stats, setStats]         = useState<ChatStats>({
    totalMessages: 0, totalTokens: 0, avgLatencyMs: 0, contextHits: 0,
  });
  const latencies = useRef<number[]>([]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return;

    const userMsg: Message = {
      id: generateId(), role: 'user', content: content.trim(), timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const history = messages.slice(-MAX_HISTORY * 2);
      const apiMessages: ChatMessage[] = [
        ...history.map((m) => ({ role: m.role as ChatMessage['role'], content: m.content })),
        { role: 'user' as const, content: content.trim() },
      ];

      const res = await sendChat(apiMessages, SESSION_ID, provider);

      const assistantMsg: Message = {
        id: generateId(), role: 'assistant', content: res.reply, timestamp: new Date(),
        provider: res.provider, model: res.model,
        tokensUsed: res.tokensUsed, contextChunks: res.contextChunks, latencyMs: res.latencyMs,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      latencies.current = [...latencies.current.slice(-9), res.latencyMs];
      const avg = Math.round(latencies.current.reduce((a, b) => a + b, 0) / latencies.current.length);
      setStats((prev) => ({
        totalMessages: prev.totalMessages + 1,
        totalTokens:   prev.totalTokens + (res.tokensUsed || 0),
        avgLatencyMs:  avg,
        contextHits:   prev.contextHits + (res.contextChunks > 0 ? 1 : 0),
      }));
    } catch (err) {
      setMessages((prev) => [...prev, {
        id: generateId(), role: 'assistant',
        content: err instanceof Error ? `⚠️ ${err.message}` : '⚠️ An unexpected error occurred.',
        timestamp: new Date(), isError: true,
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading, provider]);

  const clearMessages = useCallback(() => setMessages([]), []);

  return { messages, isLoading, provider, setProvider, sendMessage, clearMessages, stats, sessionId: SESSION_ID };
}
