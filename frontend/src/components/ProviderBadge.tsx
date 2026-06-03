'use client';

import { LLMProvider } from '@/types';

const PROVIDER_META: Record<LLMProvider, { label: string; color: string; dot: string }> = {
  deepseek: { label: 'DeepSeek', color: '#06b6d4', dot: '#0891b2' },
  anthropic: { label: 'Claude', color: '#d97706', dot: '#b45309' },
  openai: { label: 'GPT', color: '#10b981', dot: '#059669' },
};

interface Props {
  provider: LLMProvider;
  model?: string;
  size?: 'sm' | 'md';
}

export function ProviderBadge({ provider, model, size = 'sm' }: Props) {
  const meta = PROVIDER_META[provider];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: size === 'md' ? '3px 10px' : '2px 7px',
        borderRadius: '99px',
        border: `1px solid ${meta.color}40`,
        background: `${meta.color}12`,
        fontSize: size === 'md' ? '12px' : '10px',
        fontFamily: 'var(--font-mono)',
        color: meta.color,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: size === 'md' ? 7 : 6,
          height: size === 'md' ? 7 : 6,
          borderRadius: '50%',
          background: meta.color,
          flexShrink: 0,
          animation: 'pulse-dot 2s ease-in-out infinite',
        }}
      />
      {meta.label}
      {model && size === 'md' && (
        <span style={{ opacity: 0.6, marginLeft: 2 }}>· {model}</span>
      )}
    </span>
  );
}
