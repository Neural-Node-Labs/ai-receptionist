'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import {
  ingestKnowledge,
  getKnowledgeStats,
  uploadKnowledgeFile,
  SUPPORTED_UPLOAD_EXTENSIONS,
  MAX_UPLOAD_SIZE_MB,
} from '@/lib/api';

interface Stats { totalChunks: number; sources: string[]; indexReady: boolean; }

export default function AdminPage() {
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const router = useRouter();

  const [content, setContent]     = useState('');
  const [source, setSource]       = useState('');
  const [metadata, setMetadata]   = useState('');
  const [stats, setStats]         = useState<Stats | null>(null);
  const [status, setStatus]       = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage]     = useState('');
  const [statsLoading, setStatsLoading] = useState(true);

  // File upload state
  const [uploadFile, setUploadFile]   = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [uploadMessage, setUploadMessage] = useState('');
  const [isDragging, setIsDragging]   = useState(false);

  // Auth guard — redirect non-admins
  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace('/login?from=/admin');
      return;
    }
    if (user?.role !== 'admin') {
      router.replace('/');
    }
  }, [isLoading, isAuthenticated, user, router]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const s = await getKnowledgeStats();
      setStats(s);
    } catch (err) {
      console.error('Failed to load stats', err);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && user?.role === 'admin') loadStats();
  }, [isAuthenticated, user, loadStats]);

  const handleIngest = useCallback(async () => {
    if (!content.trim() || !source.trim()) {
      setMessage('Source name and content are both required.');
      setStatus('error');
      return;
    }

    let parsedMeta: Record<string, string> = {};
    if (metadata.trim()) {
      try {
        parsedMeta = JSON.parse(metadata);
      } catch {
        setMessage('Metadata must be valid JSON (e.g. {"department": "sales"})');
        setStatus('error');
        return;
      }
    }

    setStatus('loading');
    setMessage('');

    try {
      const res = await ingestKnowledge(content.trim(), source.trim(), parsedMeta);
      setMessage(`✓ Ingested "${res.source}" — ${res.chunksCreated} chunks added to vector DB`);
      setStatus('success');
      setContent('');
      setSource('');
      setMetadata('');
      await loadStats();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ingestion failed';
      setMessage(`✗ ${msg}`);
      setStatus('error');
    }
  }, [content, source, metadata, loadStats]);

  const validateAndSetFile = useCallback((file: File | null) => {
    if (!file) { setUploadFile(null); return; }

    const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '');
    if (!SUPPORTED_UPLOAD_EXTENSIONS.includes(ext)) {
      setUploadMessage(`Unsupported file type "${ext}". Allowed: ${SUPPORTED_UPLOAD_EXTENSIONS.join(', ')}`);
      setUploadStatus('error');
      setUploadFile(null);
      return;
    }
    if (file.size > MAX_UPLOAD_SIZE_MB * 1024 * 1024) {
      setUploadMessage(`File exceeds ${MAX_UPLOAD_SIZE_MB}MB limit (${(file.size / (1024 * 1024)).toFixed(1)}MB)`);
      setUploadStatus('error');
      setUploadFile(null);
      return;
    }

    setUploadMessage('');
    setUploadStatus('idle');
    setUploadFile(file);
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    validateAndSetFile(e.target.files?.[0] ?? null);
  }, [validateAndSetFile]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(false);
    validateAndSetFile(e.dataTransfer.files?.[0] ?? null);
  }, [validateAndSetFile]);

  const handleUpload = useCallback(async () => {
    if (!uploadFile) return;
    setUploadStatus('loading');
    setUploadMessage('');

    try {
      const res = await uploadKnowledgeFile(uploadFile);
      setUploadMessage(`✓ "${res.source}" — ${res.chunksCreated} chunks added to vector DB`);
      setUploadStatus('success');
      setUploadFile(null);
      await loadStats();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setUploadMessage(`✗ ${msg}`);
      setUploadStatus('error');
    }
  }, [uploadFile, loadStats]);

  const handleLogout = useCallback(async () => {
    await logout();
    router.replace('/login');
  }, [logout, router]);

  // Loading / not-admin states
  if (isLoading || !isAuthenticated || user?.role !== 'admin') {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)' }}>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: '13px' }}>
          Checking access<span style={{ animation: 'blink 1s step-end infinite' }}>_</span>
        </span>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <header style={{ padding: '12px 24px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() => router.push('/')}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '4px 8px', borderRadius: '6px' }}
            title="Back to chat"
          >←</button>
          <div>
            <div style={{ fontWeight: 700, fontSize: '15px', letterSpacing: '-0.01em' }}>
              Knowledge Base Admin
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              RAG vector store management · admin only
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
            {user.username} · admin
          </span>
          <button
            onClick={handleLogout}
            style={{ padding: '5px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}
          >
            Sign out
          </button>
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', gap: '0', maxWidth: '1100px', margin: '0 auto', width: '100%', padding: '24px 24px' }}>

        {/* Left — upload form */}
        <div style={{ flex: 1, marginRight: '24px' }}>

          {/* ── File upload card ── */}
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '24px', marginBottom: '20px' }}>
            <h2 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-primary)' }}>
              Upload Document
            </h2>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '16px', fontFamily: 'var(--font-mono)' }}>
              {SUPPORTED_UPLOAD_EXTENSIONS.join(' · ')} — max {MAX_UPLOAD_SIZE_MB}MB
            </p>

            <label
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '28px 16px',
                border: `1.5px dashed ${isDragging ? 'var(--accent-blue)' : 'var(--border)'}`,
                borderRadius: '10px',
                background: isDragging ? 'rgba(37,99,235,0.06)' : 'var(--bg-base)',
                cursor: 'pointer',
                transition: 'all 0.15s',
                textAlign: 'center',
              }}
            >
              <input
                type="file"
                accept={SUPPORTED_UPLOAD_EXTENSIONS.join(',')}
                onChange={handleFileInputChange}
                style={{ display: 'none' }}
              />
              <span style={{ fontSize: '22px', opacity: 0.6 }}>⤒</span>
              {uploadFile ? (
                <>
                  <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                    {uploadFile.name}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {(uploadFile.size / 1024).toFixed(1)} KB — click or drop to replace
                  </span>
                </>
              ) : (
                <>
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    Click to browse or drag a file here
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {SUPPORTED_UPLOAD_EXTENSIONS.join('  ')}
                  </span>
                </>
              )}
            </label>

            {uploadMessage && (
              <div style={{ marginTop: '14px', padding: '10px 14px', borderRadius: '8px', fontSize: '12px', fontFamily: 'var(--font-mono)', background: uploadStatus === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${uploadStatus === 'success' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`, color: uploadStatus === 'success' ? '#10b981' : '#ef4444', lineHeight: 1.5 }}>
                {uploadMessage}
              </div>
            )}

            <button
              onClick={handleUpload}
              disabled={!uploadFile || uploadStatus === 'loading'}
              style={{ width: '100%', marginTop: '14px', padding: '11px', background: !uploadFile || uploadStatus === 'loading' ? 'var(--bg-elevated)' : 'var(--accent-blue)', border: 'none', borderRadius: '8px', color: !uploadFile || uploadStatus === 'loading' ? 'var(--text-muted)' : 'white', fontSize: '14px', fontWeight: 600, cursor: !uploadFile || uploadStatus === 'loading' ? 'not-allowed' : 'pointer', transition: 'all 0.15s' }}
            >
              {uploadStatus === 'loading' ? 'Uploading & ingesting...' : '⤒ Upload & Ingest'}
            </button>
          </div>

          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '24px' }}>
            <h2 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '20px', color: 'var(--text-primary)' }}>
              Paste Text
            </h2>

            {/* Source */}
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Source Name *
              </label>
              <input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="e.g. company-overview, product-faq, pricing-2024"
                style={{ width: '100%', padding: '9px 12px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', fontFamily: 'var(--font-mono)', boxSizing: 'border-box' }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-blue)'; }}
                onBlur={(e)  => { e.currentTarget.style.borderColor = 'var(--border)'; }}
              />
            </div>

            {/* Content */}
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Content *
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Paste company information, FAQs, product details, policies, team info..."
                rows={12}
                style={{ width: '100%', padding: '10px 12px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '13px', resize: 'vertical', outline: 'none', lineHeight: 1.65, fontFamily: 'inherit', boxSizing: 'border-box' }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-blue)'; }}
                onBlur={(e)  => { e.currentTarget.style.borderColor = 'var(--border)'; }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {content.length.toLocaleString()} chars · ~{Math.ceil(content.length / 4).toLocaleString()} tokens
                </span>
              </div>
            </div>

            {/* Metadata */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Metadata <span style={{ opacity: 0.5 }}>(optional JSON)</span>
              </label>
              <input
                value={metadata}
                onChange={(e) => setMetadata(e.target.value)}
                placeholder='{"department": "sales", "version": "2024"}'
                style={{ width: '100%', padding: '9px 12px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '12px', outline: 'none', fontFamily: 'var(--font-mono)', boxSizing: 'border-box' }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-blue)'; }}
                onBlur={(e)  => { e.currentTarget.style.borderColor = 'var(--border)'; }}
              />
            </div>

            {/* Status message */}
            {message && (
              <div style={{ padding: '10px 14px', borderRadius: '8px', marginBottom: '14px', fontSize: '12px', fontFamily: 'var(--font-mono)', background: status === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${status === 'success' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`, color: status === 'success' ? '#10b981' : '#ef4444', lineHeight: 1.5 }}>
                {message}
              </div>
            )}

            <button
              onClick={handleIngest}
              disabled={status === 'loading' || !content.trim() || !source.trim()}
              style={{ width: '100%', padding: '11px', background: status === 'loading' || !content.trim() || !source.trim() ? 'var(--bg-elevated)' : 'var(--accent-blue)', border: 'none', borderRadius: '8px', color: status === 'loading' || !content.trim() || !source.trim() ? 'var(--text-muted)' : 'white', fontSize: '14px', fontWeight: 600, cursor: status === 'loading' || !content.trim() || !source.trim() ? 'not-allowed' : 'pointer', transition: 'all 0.15s' }}
            >
              {status === 'loading' ? 'Ingesting...' : '⊕ Ingest to Vector DB'}
            </button>
          </div>
        </div>

        {/* Right — stats */}
        <div style={{ width: '280px', flexShrink: 0 }}>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '20px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 600 }}>Knowledge Base</h3>
              <button onClick={loadStats} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '13px' }}>↻</button>
            </div>

            {statsLoading ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>Loading...</div>
            ) : stats ? (
              <>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
                  <div style={{ flex: 1, background: 'var(--bg-base)', borderRadius: '8px', padding: '10px 12px', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '22px', fontWeight: 700, color: '#06b6d4', fontFamily: 'var(--font-mono)' }}>{stats.totalChunks}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>total chunks</div>
                  </div>
                  <div style={{ flex: 1, background: 'var(--bg-base)', borderRadius: '8px', padding: '10px 12px', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '22px', fontWeight: 700, color: '#10b981', fontFamily: 'var(--font-mono)' }}>{stats.sources.length}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>sources</div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '14px', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: stats.indexReady ? '#10b981' : '#ef4444', display: 'inline-block' }} />
                  <span style={{ color: stats.indexReady ? '#10b981' : '#ef4444' }}>
                    {stats.indexReady ? 'Index ready' : 'Index not ready'}
                  </span>
                </div>

                {stats.sources.length > 0 && (
                  <>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Sources</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {stats.sources.map((s) => (
                        <div key={s} style={{ padding: '5px 8px', background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.2)', borderRadius: '6px', fontSize: '11px', color: '#06b6d4', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {s}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {stats.sources.length === 0 && (
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0', fontStyle: 'italic' }}>
                    No documents ingested yet
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: '12px', color: '#ef4444', fontFamily: 'var(--font-mono)' }}>Failed to load stats</div>
            )}
          </div>

          {/* Tips */}
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '20px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>Tips</h3>
            <ul style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.7, paddingLeft: '16px', margin: 0 }}>
              <li>Use descriptive source names (e.g. <code style={{ color: '#06b6d4', fontSize: '11px' }}>product-faq</code>)</li>
              <li>Ingest multiple documents with different sources</li>
              <li>The RAG engine chunks at ~400 words with overlap</li>
              <li>Similarity threshold: 0.25 — irrelevant docs are filtered</li>
              <li>Max context per chat: ~1800 tokens</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
