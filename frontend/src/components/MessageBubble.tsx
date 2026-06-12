'use client';

import { Message } from '@/types';
import { ProviderBadge } from './ProviderBadge';

interface Props {
  message: Message;
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user';
  const isError = message.isError;

  return (
    <div
      className="animate-fade-in"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        gap: '4px',
        maxWidth: '100%',
      }}
    >
      {/* Role label */}
      <div
        style={{
          fontSize: '10px',
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-muted)',
          paddingInline: '4px',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        {isUser ? 'visitor' : (
          <>
            <span>receptionist</span>
            {message.provider && (
              <ProviderBadge provider={message.provider} model={message.model} />
            )}
          </>
        )}
      </div>

      {/* Bubble */}
      <div
        style={{
          maxWidth: '78%',
          padding: '10px 14px',
          borderRadius: isUser
            ? 'var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg)'
            : 'var(--radius-lg) var(--radius-lg) var(--radius-lg) var(--radius-sm)',
          background: isUser
            ? 'linear-gradient(135deg, #1d3a6e, #1e3a8a)'
            : isError
            ? 'rgba(239,68,68,0.08)'
            : 'var(--bg-elevated)',
          border: `1px solid ${
            isUser ? '#2563eb60' : isError ? '#ef444440' : 'var(--border)'
          }`,
          color: isError ? '#fca5a5' : 'var(--text-primary)',
          fontSize: '14px',
          lineHeight: 1.65,
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      >
        {message.content}
      </div>

      {/* Meta row */}
      {!isUser && (message.tokensUsed || message.contextChunks !== undefined || message.latencyMs) && (
        <div
          style={{
            display: 'flex',
            gap: '12px',
            paddingInline: '4px',
            fontSize: '9px',
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-muted)',
          }}
        >
          {message.tokensUsed != null && message.tokensUsed > 0 && (
            <span>⬡ {message.tokensUsed} tok</span>
          )}
          {message.contextChunks != null && message.contextChunks > 0 && (
            <span style={{ color: '#06b6d4' }}>⊛ {message.contextChunks} ctx</span>
          )}
          {message.latencyMs && <span>◷ {message.latencyMs}ms</span>}
        </div>
      )}
    </div>
  );
}
