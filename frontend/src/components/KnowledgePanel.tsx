'use client';

import { useState, useCallback } from 'react';
import { ingestKnowledge, getKnowledgeStats } from '@/lib/api';

interface KnowledgeStats {
  totalChunks: number;
  sources: string[];
  indexReady: boolean;
}

interface Props {
  onClose: () => void;
  stats: KnowledgeStats | null;
  onRefresh: () => void;
}

export function KnowledgePanel({ onClose, stats, onRefresh }: Props) {
  const [content, setContent] = useState('');
  const [source, setSource] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleIngest = useCallback(async () => {
    if (!content.trim() || !source.trim()) {
      setMessage('Please provide both content and a source name.');
      setStatus('error');
      return;
    }
    setStatus('loading');
    setMessage('');
    try {
      const res = await ingestKnowledge(content.trim(), source.trim());
      setMessage(`✓ Ingested ${res.chunksCreated} chunks from "${res.source}"`);
      setStatus('success');
      setContent('');
      setSource('');
      onRefresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ingestion failed');
      setStatus('error');
    }
  }, [content, source, onRefresh]);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(10, 14, 23, 0.92)',
        backdropFilter: 'blur(12px)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xl)',
          width: '100%',
          maxWidth: '560px',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: '15px' }}>Knowledge Base</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
              RAG vector store · {stats?.totalChunks ?? 0} chunks · {stats?.sources?.length ?? 0} sources
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '18px',
              lineHeight: 1,
              padding: '4px 8px',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            ✕
          </button>
        </div>

        {/* Sources */}
        {stats?.sources && stats.sources.length > 0 && (
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Loaded Sources
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {stats.sources.map((s) => (
                <span
                  key={s}
                  style={{
                    padding: '2px 8px',
                    background: 'rgba(6,182,212,0.1)',
                    border: '1px solid rgba(6,182,212,0.25)',
                    borderRadius: '99px',
                    fontSize: '11px',
                    color: '#06b6d4',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Form */}
        <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Source Name
            </label>
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="e.g. company-overview, product-faq, pricing..."
              style={{
                width: '100%',
                padding: '8px 12px',
                background: 'var(--bg-base)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                fontSize: '13px',
                outline: 'none',
                fontFamily: 'var(--font-mono)',
              }}
            />
          </div>
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Content
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Paste company information, FAQs, product details, policies..."
              rows={8}
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'var(--bg-base)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                fontSize: '13px',
                resize: 'vertical',
                outline: 'none',
                lineHeight: 1.6,
                fontFamily: 'inherit',
              }}
            />
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
              {content.length.toLocaleString()} chars · ~{Math.ceil(content.length / 4).toLocaleString()} tokens
            </div>
          </div>

          {message && (
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--radius-md)',
                marginBottom: '12px',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)',
                background: status === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                border: `1px solid ${status === 'success' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                color: status === 'success' ? '#10b981' : '#ef4444',
              }}
            >
              {message}
            </div>
          )}

          <button
            onClick={handleIngest}
            disabled={status === 'loading'}
            style={{
              width: '100%',
              padding: '10px',
              background: status === 'loading' ? 'var(--bg-elevated)' : 'var(--accent-blue)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              color: status === 'loading' ? 'var(--text-muted)' : 'white',
              fontSize: '14px',
              fontWeight: 600,
              cursor: status === 'loading' ? 'not-allowed' : 'pointer',
              letterSpacing: '0.03em',
              transition: 'all 0.15s',
            }}
          >
            {status === 'loading' ? 'Ingesting...' : '⊕ Ingest to Vector DB'}
          </button>
        </div>
      </div>
    </div>
  );
}
