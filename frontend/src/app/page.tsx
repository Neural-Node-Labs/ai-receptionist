'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useChat } from '@/hooks/useChat';
import { MessageBubble } from '@/components/MessageBubble';
import { TypingIndicator } from '@/components/TypingIndicator';
import { KnowledgePanel } from '@/components/KnowledgePanel';
import { StatusBar } from '@/components/StatusBar';
import { getHealth, getKnowledgeStats } from '@/lib/api';
import { HealthData, LLMProvider, ProviderInfo } from '@/types';

const PROVIDERS: ProviderInfo[] = [
  { id: 'deepseek', label: 'DeepSeek', model: 'deepseek-chat', available: true, isDefault: true },
  { id: 'anthropic', label: 'Claude', model: 'claude-haiku', available: true, isDefault: false },
  { id: 'openai', label: 'GPT-4o mini', model: 'gpt-4o-mini', available: true, isDefault: false },
];

const WELCOME_MESSAGE = `Hello! I'm your AI receptionist. I can answer questions about our company, help you find the right contact, or provide information from our knowledge base.

How can I assist you today?`;

const QUICK_PROMPTS = [
  'What services do you offer?',
  'How can I contact support?',
  'What are your business hours?',
  'Tell me about your team',
];

export default function Home() {
  const [showKnowledge, setShowKnowledge] = useState(false);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [knowledgeStats, setKnowledgeStats] = useState<{
    totalChunks: number;
    sources: string[];
    indexReady: boolean;
  } | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [showProviderMenu, setShowProviderMenu] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { messages, isLoading, provider, setProvider, sendMessage, clearMessages, stats, sessionId } =
    useChat('deepseek');

  // Welcome message
  const hasWelcome = useRef(false);
  useEffect(() => {
    if (!hasWelcome.current && messages.length === 0) {
      hasWelcome.current = true;
    }
  }, [messages.length]);

  // Health polling
  const refreshHealth = useCallback(async () => {
    try {
      const h = await getHealth();
      setHealth(h);
    } catch {}
  }, []);

  const refreshKnowledge = useCallback(async () => {
    try {
      const k = await getKnowledgeStats();
      setKnowledgeStats(k);
    } catch {}
  }, []);

  useEffect(() => {
    refreshHealth();
    refreshKnowledge();
    const interval = setInterval(refreshHealth, 15_000);
    return () => clearInterval(interval);
  }, [refreshHealth, refreshKnowledge]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSend = useCallback(async () => {
    const val = inputValue.trim();
    if (!val || isLoading) return;
    setInputValue('');
    await sendMessage(val);
  }, [inputValue, isLoading, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleQuickPrompt = useCallback(
    async (prompt: string) => {
      setInputValue('');
      await sendMessage(prompt);
    },
    [sendMessage]
  );

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-base)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* ── Header ── */}
      <header
        style={{
          padding: '12px 20px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
          gap: '12px',
        }}
      >
        {/* Logo / Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #1d4ed8, #06b6d4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '17px',
              flexShrink: 0,
            }}
          >
            ◈
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '15px', letterSpacing: '-0.02em' }}>
              AI Receptionist
            </div>
            <div
              style={{
                fontSize: '10px',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.06em',
              }}
            >
              CBD Architecture · RAG-Powered
            </div>
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Provider selector */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowProviderMenu((v) => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-secondary)',
                fontSize: '12px',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                transition: 'all 0.15s',
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: provider === 'deepseek' ? '#06b6d4' : provider === 'anthropic' ? '#d97706' : '#10b981',
                }}
              />
              {provider}
              <span style={{ opacity: 0.5, fontSize: '10px' }}>▾</span>
            </button>

            {showProviderMenu && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  right: 0,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  minWidth: '160px',
                  zIndex: 20,
                  overflow: 'hidden',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                }}
              >
                {PROVIDERS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setProvider(p.id as LLMProvider);
                      setShowProviderMenu(false);
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 14px',
                      background: provider === p.id ? 'rgba(37,99,235,0.15)' : 'transparent',
                      border: 'none',
                      borderLeft: provider === p.id ? '2px solid var(--accent-blue)' : '2px solid transparent',
                      color: provider === p.id ? 'var(--text-accent)' : 'var(--text-secondary)',
                      fontSize: '12px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'var(--font-mono)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      transition: 'all 0.1s',
                    }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: p.id === 'deepseek' ? '#06b6d4' : p.id === 'anthropic' ? '#d97706' : '#10b981',
                      }}
                    />
                    <span>{p.label}</span>
                    <span style={{ opacity: 0.4, fontSize: '10px', marginLeft: 'auto' }}>{p.model}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Knowledge base button */}
          <button
            onClick={() => setShowKnowledge(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 12px',
              background: knowledgeStats && knowledgeStats.totalChunks > 0
                ? 'rgba(6,182,212,0.1)'
                : 'var(--bg-elevated)',
              border: `1px solid ${knowledgeStats && knowledgeStats.totalChunks > 0 ? 'rgba(6,182,212,0.35)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-md)',
              color: knowledgeStats && knowledgeStats.totalChunks > 0 ? '#06b6d4' : 'var(--text-secondary)',
              fontSize: '12px',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
            }}
          >
            ⊛ KB {knowledgeStats ? `(${knowledgeStats.totalChunks})` : ''}
          </button>

          {/* Clear */}
          {messages.length > 0 && (
            <button
              onClick={clearMessages}
              title="Clear conversation"
              style={{
                padding: '6px 10px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-muted)',
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              ⌫
            </button>
          )}
        </div>
      </header>

      {/* ── Messages ── */}
      <main
        onClick={() => setShowProviderMenu(false)}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        {/* Welcome */}
        {messages.length === 0 && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '24px', textAlign: 'center' }}>
            <div>
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: '18px',
                  background: 'linear-gradient(135deg, #1d4ed8, #06b6d4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '28px',
                  margin: '0 auto 16px',
                  boxShadow: '0 0 40px rgba(37,99,235,0.3)',
                }}
              >
                ◈
              </div>
              <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px', letterSpacing: '-0.02em' }}>
                Welcome
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '13px', maxWidth: '360px', lineHeight: 1.7 }}>
                {WELCOME_MESSAGE}
              </div>
            </div>

            {/* Quick prompts */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', maxWidth: '420px' }}>
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => handleQuickPrompt(p)}
                  style={{
                    padding: '7px 14px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: '99px',
                    color: 'var(--text-secondary)',
                    fontSize: '12px',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent-blue)';
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-accent)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)';
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Chat messages */}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Typing indicator */}
        {isLoading && <TypingIndicator />}

        <div ref={messagesEndRef} />
      </main>

      {/* ── Input ── */}
      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-surface)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: '8px',
            alignItems: 'flex-end',
            background: 'var(--bg-elevated)',
            border: `1px solid var(--border)`,
            borderRadius: 'var(--radius-lg)',
            padding: '8px 8px 8px 14px',
            transition: 'border-color 0.2s',
          }}
          onFocusCapture={(e) => {
            (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--accent-blue)';
          }}
          onBlurCapture={(e) => {
            (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)';
          }}
        >
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message… (Enter to send, Shift+Enter for newline)"
            disabled={isLoading}
            rows={1}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: 'var(--text-primary)',
              fontSize: '14px',
              resize: 'none',
              outline: 'none',
              lineHeight: 1.6,
              maxHeight: '120px',
              overflowY: 'auto',
              fontFamily: 'inherit',
              opacity: isLoading ? 0.5 : 1,
            }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 120) + 'px';
            }}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !inputValue.trim()}
            style={{
              flexShrink: 0,
              width: 36,
              height: 36,
              borderRadius: 'var(--radius-md)',
              background: isLoading || !inputValue.trim() ? 'var(--bg-hover)' : 'var(--accent-blue)',
              border: 'none',
              color: isLoading || !inputValue.trim() ? 'var(--text-muted)' : 'white',
              cursor: isLoading || !inputValue.trim() ? 'not-allowed' : 'pointer',
              fontSize: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s',
            }}
          >
            {isLoading ? '⋯' : '↑'}
          </button>
        </div>
        <div
          style={{
            fontSize: '10px',
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            marginTop: '6px',
            paddingInline: '2px',
          }}
        >
          Enter ↵ to send · Shift+Enter for newline · Using: {provider}
        </div>
      </div>

      {/* ── Status Bar ── */}
      <StatusBar health={health} stats={stats} sessionId={sessionId} />

      {/* ── Knowledge Panel ── */}
      {showKnowledge && (
        <KnowledgePanel
          onClose={() => setShowKnowledge(false)}
          stats={knowledgeStats}
          onRefresh={refreshKnowledge}
        />
      )}
    </div>
  );
}
