'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useChat } from '@/hooks/useChat';
import { MessageBubble } from '@/components/MessageBubble';
import { TypingIndicator } from '@/components/TypingIndicator';
import { StatusBar } from '@/components/StatusBar';
import { getHealth } from '@/lib/api';
import { HealthData, LLMProvider } from '@/types';

const PROVIDERS = [
  { id: 'deepseek'  as LLMProvider, label: 'DeepSeek',    dot: '#06b6d4' },
  { id: 'anthropic' as LLMProvider, label: 'Claude',       dot: '#d97706' },
  { id: 'openai'    as LLMProvider, label: 'GPT-4o mini',  dot: '#10b981' },
];

const WELCOME =
  "Hello! I'm your AI receptionist. I can answer questions about our company, " +
  "help you find the right contact, or provide information from our knowledge base.\n\n" +
  "How can I assist you today?";

const QUICK_PROMPTS = [
  'What services do you offer?',
  'How can I contact support?',
  'What are your business hours?',
  'Tell me about your team',
];

export default function Home() {
  const { user, isAuthenticated, logout } = useAuth();
  const router = useRouter();

  const [health, setHealth]               = useState<HealthData | null>(null);
  const [inputValue, setInputValue]       = useState('');
  const [showProviderMenu, setProviderMenu] = useState(false);
  const [showUserMenu, setUserMenu]       = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);

  const {
    messages, isLoading, provider, setProvider,
    sendMessage, clearMessages, stats, sessionId,
  } = useChat('deepseek');

  // Health poll (public endpoint)
  useEffect(() => {
    getHealth().then(setHealth).catch(() => {});
    const iv = setInterval(() => getHealth().then(setHealth).catch(() => {}), 15_000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSend = useCallback(async () => {
    const val = inputValue.trim();
    if (!val || isLoading) return;
    setInputValue('');
    await sendMessage(val);
  }, [inputValue, isLoading, sendMessage]);

  const handleKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const handleLogout = useCallback(async () => {
    setUserMenu(false);
    await logout();
  }, [logout]);

  return (
    <div
      style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-base)', position: 'relative', overflow: 'hidden' }}
      onClick={() => { setProviderMenu(false); setUserMenu(false); }}
    >
      {/* ── Header ── */}
      <header style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, gap: '10px' }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: 34, height: 34, borderRadius: '10px', background: 'linear-gradient(135deg, #1d4ed8, #06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>◈</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '14px', letterSpacing: '-0.02em' }}>AI Receptionist</div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>CBD · RAG · FastAPI</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Provider selector */}
          <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => { setProviderMenu(v => !v); setUserMenu(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: PROVIDERS.find(p => p.id === provider)?.dot ?? '#06b6d4' }} />
              {provider} <span style={{ opacity: 0.5 }}>▾</span>
            </button>
            {showProviderMenu && (
              <div style={{ position: 'absolute', top: 'calc(100% + 5px)', right: 0, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', minWidth: '140px', zIndex: 30, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
                {PROVIDERS.map((p) => (
                  <button key={p.id}
                    onClick={() => { setProvider(p.id); setProviderMenu(false); }}
                    style={{ width: '100%', padding: '7px 12px', background: provider === p.id ? 'rgba(37,99,235,0.15)' : 'transparent', border: 'none', borderLeft: provider === p.id ? '2px solid var(--accent-blue)' : '2px solid transparent', color: provider === p.id ? 'var(--text-accent)' : 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: '7px' }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.dot }} />
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Clear */}
          {messages.length > 0 && (
            <button onClick={clearMessages} title="Clear conversation" style={{ padding: '5px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-muted)', fontSize: '12px', cursor: 'pointer' }}>⌫</button>
          )}

          {/* User menu / login */}
          {isAuthenticated && user ? (
            <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => { setUserMenu(v => !v); setProviderMenu(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: user.role === 'admin' ? '#f59e0b' : '#06b6d4' }} />
                {user.username} <span style={{ opacity: 0.5 }}>▾</span>
              </button>
              {showUserMenu && (
                <div style={{ position: 'absolute', top: 'calc(100% + 5px)', right: 0, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', minWidth: '160px', zIndex: 30, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
                  <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{user.username}</div>
                    <div style={{ fontSize: '10px', color: user.role === 'admin' ? '#f59e0b' : '#06b6d4', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>● {user.role}</div>
                  </div>
                  {user.role === 'admin' && (
                    <button
                      onClick={() => { setUserMenu(false); router.push('/admin'); }}
                      style={{ width: '100%', padding: '8px 12px', background: 'transparent', border: 'none', color: '#06b6d4', fontSize: '11px', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: '7px' }}
                    >
                      ⊛ Knowledge Base
                    </button>
                  )}
                  <button
                    onClick={handleLogout}
                    style={{ width: '100%', padding: '8px 12px', background: 'transparent', border: 'none', color: '#ef4444', fontSize: '11px', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: '7px' }}
                  >
                    ⊘ Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => router.push('/login')}
              style={{ padding: '5px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}
            >
              Admin Login
            </button>
          )}
        </div>
      </header>

      {/* ── Messages ── */}
      <main style={{ flex: 1, overflowY: 'auto', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {messages.length === 0 && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '24px', textAlign: 'center' }}>
            <div>
              <div style={{ width: 56, height: 56, borderRadius: '16px', background: 'linear-gradient(135deg, #1d4ed8, #06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', margin: '0 auto 14px', boxShadow: '0 0 40px rgba(37,99,235,0.3)' }}>◈</div>
              <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px', letterSpacing: '-0.02em' }}>Welcome</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '13px', maxWidth: '360px', lineHeight: 1.7, whiteSpace: 'pre-line' }}>{WELCOME}</div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', maxWidth: '420px' }}>
              {QUICK_PROMPTS.map((p) => (
                <button key={p} onClick={() => sendMessage(p)}
                  style={{ padding: '6px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '99px', color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', transition: 'all 0.15s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent-blue)'; e.currentTarget.style.color = 'var(--text-accent)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >{p}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}
        {isLoading && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </main>

      {/* ── Input ── */}
      <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
        <div
          style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '12px', padding: '8px 8px 8px 14px', transition: 'border-color 0.2s' }}
          onFocusCapture={(e) => { e.currentTarget.style.borderColor = 'var(--accent-blue)'; }}
          onBlurCapture={(e)  => { e.currentTarget.style.borderColor = 'var(--border)'; }}
        >
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask me anything… (Enter to send, Shift+Enter for newline)"
            disabled={isLoading}
            rows={1}
            style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '14px', resize: 'none', outline: 'none', lineHeight: 1.6, maxHeight: '120px', overflowY: 'auto', fontFamily: 'inherit', opacity: isLoading ? 0.5 : 1 }}
            onInput={(e) => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !inputValue.trim()}
            style={{ flexShrink: 0, width: 34, height: 34, borderRadius: '8px', background: isLoading || !inputValue.trim() ? 'var(--bg-hover)' : 'var(--accent-blue)', border: 'none', color: isLoading || !inputValue.trim() ? 'var(--text-muted)' : 'white', cursor: isLoading || !inputValue.trim() ? 'not-allowed' : 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}
          >
            {isLoading ? '⋯' : '↑'}
          </button>
        </div>
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: '5px', paddingInline: '2px' }}>
          Enter ↵ send · Shift+Enter newline · {provider}
        </div>
      </div>

      <StatusBar health={health} stats={stats} sessionId={sessionId} />
    </div>
  );
}
