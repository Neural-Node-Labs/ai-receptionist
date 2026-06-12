'use client';

import { HealthData, ChatStats } from '@/types';

interface Props {
  health: HealthData | null;
  stats: ChatStats;
  sessionId: string;
}

export function StatusBar({ health, stats, sessionId }: Props) {
  const isOnline = health?.status === 'ok';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 16px',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-surface)',
        fontSize: '10px',
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-muted)',
        flexShrink: 0,
        gap: '12px',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* Online status */}
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: isOnline ? 'var(--accent-green)' : 'var(--accent-red)',
              animation: isOnline ? 'pulse-dot 2s ease-in-out infinite' : 'none',
            }}
          />
          {isOnline ? 'ONLINE' : health ? 'DEGRADED' : 'CONNECTING'}
        </span>

        {/* Knowledge */}
        {health?.knowledgeChunks != null && (
          <span style={{ color: '#06b6d4' }}>
            ⊛ {health.knowledgeChunks} chunks
          </span>
        )}

        {/* Default provider */}
        {health?.defaultProvider && (
          <span>⬡ {health.defaultProvider}</span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* Stats */}
        {stats.totalMessages > 0 && (
          <>
            <span>◈ {stats.totalMessages} msgs</span>
            <span>⬡ {stats.totalTokens.toLocaleString()} tok</span>
            {stats.avgLatencyMs > 0 && <span>◷ {stats.avgLatencyMs}ms avg</span>}
            {stats.contextHits > 0 && (
              <span style={{ color: '#06b6d4' }}>
                ⊛ {stats.contextHits} ctx hits
              </span>
            )}
          </>
        )}

        {/* Session */}
        <span style={{ opacity: 0.5 }}>
          {sessionId.slice(0, 8)}
        </span>
      </div>
    </div>
  );
}
