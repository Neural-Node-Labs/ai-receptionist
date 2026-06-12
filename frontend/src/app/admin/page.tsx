'use client';

/**
 * Admin Page — AI Receptionist
 *
 * Three tabs:
 *  1. Knowledge Base — upload docs, view ingested sources, delete entries
 *  2. Theme          — live-edit CSS tokens, persist to /manifest.json
 *  3. Users          — (placeholder) user management
 *
 * RAG-only directive is enforced server-side in llm_service.py, but a
 * reminder badge is shown here for visibility.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

// ── API helpers ───────────────────────────────────────────────────────────────

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

async function apiFetch(path: string, init?: RequestInit) {
  const token = localStorage.getItem('access_token');
  const res = await fetch(`${API}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface KnowledgeStats {
  total_chunks: number;
  sources: string[];
  index_ready: boolean;
}

interface ThemeTokens {
  bgBase: string;
  bgSurface: string;
  bgElevated: string;
  bgHover: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textAccent: string;
  accentBlue: string;
  accentCyan: string;
  fontMono: string;
}

const DEFAULT_THEME: ThemeTokens = {
  bgBase:        '#0a0e1a',
  bgSurface:     '#0f1629',
  bgElevated:    '#1a2035',
  bgHover:       '#1e2640',
  border:        '#1e2d4a',
  textPrimary:   '#e2e8f0',
  textSecondary: '#94a3b8',
  textMuted:     '#475569',
  textAccent:    '#93c5fd',
  accentBlue:    '#2563eb',
  accentCyan:    '#06b6d4',
  fontMono:      "'JetBrains Mono', 'Fira Code', monospace",
};

const THEME_LABELS: Record<keyof ThemeTokens, string> = {
  bgBase:        'Background Base',
  bgSurface:     'Surface',
  bgElevated:    'Elevated Panel',
  bgHover:       'Hover State',
  border:        'Border',
  textPrimary:   'Text Primary',
  textSecondary: 'Text Secondary',
  textMuted:     'Text Muted',
  textAccent:    'Text Accent',
  accentBlue:    'Accent Blue',
  accentCyan:    'Accent Cyan',
  fontMono:      'Monospace Font Stack',
};

// ── Preset themes ─────────────────────────────────────────────────────────────

const PRESETS: Record<string, ThemeTokens> = {
  'Midnight Blue': DEFAULT_THEME,
  'Deep Purple': {
    ...DEFAULT_THEME,
    bgBase:     '#0d0a1a',
    bgSurface:  '#130f24',
    bgElevated: '#1e1835',
    bgHover:    '#241e40',
    border:     '#2d1e4a',
    accentBlue: '#7c3aed',
    accentCyan: '#a855f7',
    textAccent: '#c4b5fd',
  },
  'Forest Dark': {
    ...DEFAULT_THEME,
    bgBase:     '#0a1210',
    bgSurface:  '#0f1e1a',
    bgElevated: '#162820',
    bgHover:    '#1a3028',
    border:     '#1e4035',
    accentBlue: '#059669',
    accentCyan: '#10b981',
    textAccent: '#6ee7b7',
  },
  'Crimson Night': {
    ...DEFAULT_THEME,
    bgBase:     '#120a0a',
    bgSurface:  '#1e0f0f',
    bgElevated: '#2a1515',
    bgHover:    '#331a1a',
    border:     '#4a1e1e',
    accentBlue: '#dc2626',
    accentCyan: '#f87171',
    textAccent: '#fca5a5',
  },
  'Arctic Light': {
    bgBase:        '#f0f4f8',
    bgSurface:     '#ffffff',
    bgElevated:    '#e2e8f0',
    bgHover:       '#cbd5e1',
    border:        '#cbd5e1',
    textPrimary:   '#0f172a',
    textSecondary: '#475569',
    textMuted:     '#94a3b8',
    textAccent:    '#1d4ed8',
    accentBlue:    '#2563eb',
    accentCyan:    '#0891b2',
    fontMono:      "'JetBrains Mono', 'Fira Code', monospace",
  },
};

// ── Apply theme to document ───────────────────────────────────────────────────

function applyTheme(t: ThemeTokens) {
  const root = document.documentElement;
  root.style.setProperty('--bg-base',       t.bgBase);
  root.style.setProperty('--bg-surface',    t.bgSurface);
  root.style.setProperty('--bg-elevated',   t.bgElevated);
  root.style.setProperty('--bg-hover',      t.bgHover);
  root.style.setProperty('--border',        t.border);
  root.style.setProperty('--text-primary',  t.textPrimary);
  root.style.setProperty('--text-secondary',t.textSecondary);
  root.style.setProperty('--text-muted',    t.textMuted);
  root.style.setProperty('--text-accent',   t.textAccent);
  root.style.setProperty('--accent-blue',   t.accentBlue);
  root.style.setProperty('--accent-cyan',   t.accentCyan);
  root.style.setProperty('--font-mono',     t.fontMono);
}

function loadStoredTheme(): ThemeTokens {
  try {
    const raw = localStorage.getItem('ai_receptionist_theme');
    if (raw) return { ...DEFAULT_THEME, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_THEME;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  const [tab, setTab] = useState<'knowledge' | 'theme' | 'users'>('knowledge');

  // ── Knowledge state ──────────────────────────────────────────────────────
  const [stats, setStats]             = useState<KnowledgeStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [uploading, setUploading]     = useState(false);
  const [uploadMsg, setUploadMsg]     = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [deleting, setDeleting]       = useState<string | null>(null);
  const fileRef                       = useRef<HTMLInputElement>(null);

  // ── Theme state ──────────────────────────────────────────────────────────
  const [theme, setTheme]             = useState<ThemeTokens>(DEFAULT_THEME);
  const [themeMsg, setThemeMsg]       = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [selectedPreset, setPreset]   = useState<string>('Midnight Blue');

  // ── Auth guard ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoading && (!isAuthenticated || user?.role !== 'admin')) {
      router.replace('/');
    }
  }, [isAuthenticated, isLoading, user, router]);

  // ── Load theme on mount ───────────────────────────────────────────────────
  useEffect(() => {
    const stored = loadStoredTheme();
    setTheme(stored);
    applyTheme(stored);
  }, []);

  // ── Fetch knowledge stats ─────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const data = await apiFetch('/api/knowledge/stats');
      setStats(data);
    } catch (e: any) {
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'knowledge') fetchStats();
  }, [tab, fetchStats]);

  // ── Upload handler ────────────────────────────────────────────────────────
  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;

    setUploading(true);
    setUploadMsg(null);

    const results: string[] = [];
    const errors:  string[] = [];

    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append('file', file);
      try {
        const res = await apiFetch('/api/knowledge/upload', { method: 'POST', body: fd });
        results.push(`${file.name} — ${res.chunks_added ?? '?'} chunks`);
      } catch (err: any) {
        errors.push(`${file.name}: ${err.message}`);
      }
    }

    if (errors.length === 0) {
      setUploadMsg({ type: 'ok', text: `Ingested: ${results.join(' · ')}` });
    } else if (results.length === 0) {
      setUploadMsg({ type: 'err', text: errors.join(' · ') });
    } else {
      setUploadMsg({ type: 'ok', text: `${results.join(' · ')} | Errors: ${errors.join(' · ')}` });
    }

    if (fileRef.current) fileRef.current.value = '';
    setUploading(false);
    await fetchStats();
  }, [fetchStats]);

  // ── Delete source ─────────────────────────────────────────────────────────
  const handleDelete = useCallback(async (source: string) => {
    if (!confirm(`Delete all chunks from "${source}"?`)) return;
    setDeleting(source);
    try {
      await apiFetch('/api/knowledge/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
      });
      await fetchStats();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    } finally {
      setDeleting(null);
    }
  }, [fetchStats]);

  // ── Theme handlers ────────────────────────────────────────────────────────
  const handleThemeChange = useCallback((key: keyof ThemeTokens, val: string) => {
    setTheme(prev => {
      const next = { ...prev, [key]: val };
      applyTheme(next);
      return next;
    });
  }, []);

  const handlePreset = useCallback((name: string) => {
    setPreset(name);
    const t = PRESETS[name];
    setTheme(t);
    applyTheme(t);
  }, []);

  const handleSaveTheme = useCallback(async () => {
    try {
      localStorage.setItem('ai_receptionist_theme', JSON.stringify(theme));

      // Persist to manifest.json via API (backend writes public/manifest.json)
      await apiFetch('/api/settings/theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme }),
      });
      setThemeMsg({ type: 'ok', text: 'Theme saved to manifest.json ✓' });
    } catch {
      // If backend endpoint doesn't exist yet, localStorage is still saved
      localStorage.setItem('ai_receptionist_theme', JSON.stringify(theme));
      setThemeMsg({ type: 'ok', text: 'Theme saved locally ✓ (manifest endpoint not yet configured)' });
    }
    setTimeout(() => setThemeMsg(null), 4000);
  }, [theme]);

  const handleResetTheme = useCallback(() => {
    setTheme(DEFAULT_THEME);
    applyTheme(DEFAULT_THEME);
    setPreset('Midnight Blue');
    localStorage.removeItem('ai_receptionist_theme');
    setThemeMsg({ type: 'ok', text: 'Theme reset to default ✓' });
    setTimeout(() => setThemeMsg(null), 3000);
  }, []);

  // ── Render helpers ────────────────────────────────────────────────────────

  const isColorKey = (key: keyof ThemeTokens) => key !== 'fontMono';

  if (isLoading) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)' }}>
      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: '13px' }}>Loading…</span>
    </div>
  );

  // ── Shared style tokens ───────────────────────────────────────────────────
  const card: React.CSSProperties = {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    padding: '20px',
  };

  const badge = (color: string): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: '5px',
    padding: '3px 10px', borderRadius: '99px',
    background: `${color}22`, border: `1px solid ${color}55`,
    color, fontSize: '10px', fontFamily: 'var(--font-mono)',
  });

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <header style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={() => router.push('/')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>←</button>
          <div style={{ width: 32, height: 32, borderRadius: '9px', background: 'linear-gradient(135deg,#1d4ed8,#06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px' }}>◈</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '13px' }}>Admin Console</div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>AI Receptionist · {user?.username}</div>
          </div>
        </div>

        {/* RAG-only badge */}
        <div style={badge('#10b981')}>
          <span>⊛</span> RAG-ONLY MODE ACTIVE
        </div>
      </header>

      {/* Tabs */}
      <div style={{ padding: '0 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', gap: '0' }}>
        {(['knowledge', 'theme', 'users'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              padding: '10px 18px', background: 'none', border: 'none',
              borderBottom: tab === t ? '2px solid var(--accent-blue)' : '2px solid transparent',
              color: tab === t ? 'var(--text-accent)' : 'var(--text-muted)',
              fontSize: '12px', cursor: 'pointer', fontFamily: 'var(--font-mono)',
              textTransform: 'capitalize', transition: 'all 0.15s',
            }}
          >{t === 'knowledge' ? '⊛ Knowledge Base' : t === 'theme' ? '◑ Theme' : '⊙ Users'}</button>
        ))}
      </div>

      {/* Body */}
      <main style={{ flex: 1, padding: '24px 20px', maxWidth: '860px', width: '100%', margin: '0 auto' }}>

        {/* ── KNOWLEDGE TAB ── */}
        {tab === 'knowledge' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* RAG-only directive notice */}
            <div style={{ ...card, borderColor: '#10b98133', background: '#10b98108', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <span style={{ fontSize: '20px', marginTop: '2px' }}>⊛</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: '13px', color: '#6ee7b7', marginBottom: '4px' }}>RAG-Only Directive Enabled</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  The AI assistant is configured to answer <strong style={{ color: 'var(--text-primary)' }}>only from indexed knowledge documents</strong>.
                  It will not use prior training knowledge or hallucinate facts.
                  If no relevant document chunk is found, it will tell the user it doesn't have that information.
                </div>
              </div>
            </div>

            {/* Upload */}
            <div style={card}>
              <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '14px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Upload Documents
              </div>
              <div
                style={{ border: '1px dashed var(--border)', borderRadius: '10px', padding: '28px', textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s' }}
                onClick={() => fileRef.current?.click()}
                onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--accent-blue)'; }}
                onDragLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                onDrop={e => {
                  e.preventDefault();
                  e.currentTarget.style.borderColor = 'var(--border)';
                  const dt = e.dataTransfer.files;
                  if (dt.length && fileRef.current) {
                    // Simulate change event
                    const dummyEvent = { target: { files: dt } } as any;
                    handleUpload(dummyEvent);
                  }
                }}
              >
                <div style={{ fontSize: '28px', marginBottom: '10px' }}>⊕</div>
                <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>
                  {uploading ? 'Ingesting…' : 'Click or drag files here'}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  PDF · DOCX · TXT · MD — max 10 MB each
                </div>
              </div>
              <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.txt,.md" style={{ display: 'none' }} onChange={handleUpload} />

              {uploadMsg && (
                <div style={{
                  marginTop: '12px', padding: '10px 14px', borderRadius: '8px',
                  background: uploadMsg.type === 'ok' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                  border: `1px solid ${uploadMsg.type === 'ok' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                  color: uploadMsg.type === 'ok' ? '#6ee7b7' : '#fca5a5',
                  fontSize: '12px', fontFamily: 'var(--font-mono)',
                }}>
                  {uploadMsg.type === 'ok' ? '✓' : '⚠'} {uploadMsg.text}
                </div>
              )}
            </div>

            {/* Index stats + sources */}
            <div style={card}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Indexed Knowledge
                </div>
                <button onClick={fetchStats} disabled={statsLoading}
                  style={{ padding: '4px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>
                  {statsLoading ? '…' : '↺ Refresh'}
                </button>
              </div>

              {/* Stat tiles */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '10px', marginBottom: '18px' }}>
                {[
                  { label: 'Total Chunks', value: stats?.total_chunks ?? '—' },
                  { label: 'Sources',      value: stats?.sources.length ?? '—' },
                  { label: 'Index',        value: stats?.index_ready ? 'Ready ✓' : 'Not ready' },
                ].map(s => (
                  <div key={s.label} style={{ background: 'var(--bg-elevated)', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-accent)' }}>{String(s.value)}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '3px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Sources list */}
              {stats && stats.sources.length === 0 && (
                <div style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)', fontSize: '13px' }}>
                  <div style={{ fontSize: '28px', marginBottom: '10px', opacity: 0.4 }}>⊘</div>
                  No documents ingested yet. Upload files above to populate the knowledge base.
                </div>
              )}

              {stats && stats.sources.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {stats.sources.map(src => (
                    <div key={src} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '14px', opacity: 0.7 }}>
                          {src.endsWith('.pdf') ? '📄' : src.endsWith('.docx') ? '📝' : '📋'}
                        </span>
                        <div>
                          <div style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{src}</div>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                            Indexed · available to RAG
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDelete(src)}
                        disabled={deleting === src}
                        style={{ padding: '4px 10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '6px', color: '#f87171', fontSize: '11px', cursor: 'pointer', fontFamily: 'var(--font-mono)', opacity: deleting === src ? 0.5 : 1 }}
                      >
                        {deleting === src ? '…' : '⊘ Delete'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── THEME TAB ── */}
        {tab === 'theme' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* Presets */}
            <div style={card}>
              <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '14px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Presets
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {Object.keys(PRESETS).map(name => (
                  <button key={name} onClick={() => handlePreset(name)}
                    style={{
                      padding: '6px 14px', borderRadius: '99px', fontSize: '12px', cursor: 'pointer',
                      border: selectedPreset === name ? '1px solid var(--accent-blue)' : '1px solid var(--border)',
                      background: selectedPreset === name ? 'rgba(37,99,235,0.15)' : 'var(--bg-elevated)',
                      color: selectedPreset === name ? 'var(--text-accent)' : 'var(--text-secondary)',
                      display: 'flex', alignItems: 'center', gap: '7px',
                    }}
                  >
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: PRESETS[name].accentBlue, display: 'inline-block' }} />
                    {name}
                  </button>
                ))}
              </div>
            </div>

            {/* Token editor */}
            <div style={card}>
              <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '16px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Custom Tokens
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: '12px' }}>
                {(Object.keys(theme) as (keyof ThemeTokens)[]).map(key => (
                  <div key={key}>
                    <label style={{ display: 'block', fontSize: '10px', color: 'var(--text-muted)', marginBottom: '5px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {THEME_LABELS[key]}
                    </label>
                    {isColorKey(key) ? (
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input type="color" value={theme[key]} onChange={e => handleThemeChange(key, e.target.value)}
                          style={{ width: 36, height: 32, padding: '2px', border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer', background: 'var(--bg-elevated)' }} />
                        <input type="text" value={theme[key]} onChange={e => handleThemeChange(key, e.target.value)}
                          style={{ flex: 1, padding: '7px 10px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '12px', outline: 'none', fontFamily: 'var(--font-mono)' }} />
                      </div>
                    ) : (
                      <input type="text" value={theme[key]} onChange={e => handleThemeChange(key, e.target.value)}
                        style={{ width: '100%', padding: '7px 10px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '12px', outline: 'none', fontFamily: 'var(--font-mono)', boxSizing: 'border-box' }} />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Live preview strip */}
            <div style={{ ...card, background: theme.bgBase, border: `1px solid ${theme.border}` }}>
              <div style={{ fontSize: '10px', color: theme.textMuted, fontFamily: theme.fontMono, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '14px' }}>Live Preview</div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ padding: '8px 16px', background: theme.accentBlue, borderRadius: '8px', color: '#fff', fontSize: '13px', fontWeight: 600 }}>Primary Button</div>
                <div style={{ padding: '8px 16px', background: theme.bgElevated, border: `1px solid ${theme.border}`, borderRadius: '8px', color: theme.textSecondary, fontSize: '13px' }}>Secondary</div>
                <div style={{ padding: '4px 12px', background: `${theme.accentCyan}22`, border: `1px solid ${theme.accentCyan}55`, borderRadius: '99px', color: theme.accentCyan, fontSize: '11px', fontFamily: theme.fontMono }}>● Badge</div>
                <div style={{ fontSize: '13px', color: theme.textPrimary }}>Primary text</div>
                <div style={{ fontSize: '13px', color: theme.textSecondary }}>Secondary text</div>
                <div style={{ fontSize: '13px', color: theme.textAccent, fontFamily: theme.fontMono }}>Accent mono</div>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <button onClick={handleSaveTheme}
                style={{ padding: '10px 22px', background: 'var(--accent-blue)', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
                ↓ Save to manifest.json
              </button>
              <button onClick={handleResetTheme}
                style={{ padding: '10px 18px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-secondary)', fontSize: '13px', cursor: 'pointer' }}>
                Reset defaults
              </button>
              {themeMsg && (
                <div style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: themeMsg.type === 'ok' ? '#6ee7b7' : '#fca5a5' }}>
                  {themeMsg.type === 'ok' ? '✓' : '⚠'} {themeMsg.text}
                </div>
              )}
            </div>

            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', lineHeight: 1.7 }}>
              Theme is stored in <code style={{ color: 'var(--text-accent)' }}>localStorage</code> for instant load on every visit,
              and optionally persisted to <code style={{ color: 'var(--text-accent)' }}>public/manifest.json</code> via
              <code style={{ color: 'var(--text-accent)' }}> POST /api/settings/theme</code> for cross-device consistency.
            </div>
          </div>
        )}

        {/* ── USERS TAB ── */}
        {tab === 'users' && (
          <div style={card}>
            <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '14px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              User Management
            </div>
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)', fontSize: '13px' }}>
              <div style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.3 }}>⊙</div>
              User management is configured via environment variables.<br />
              See <code style={{ color: 'var(--text-accent)', fontFamily: 'var(--font-mono)' }}>ADMIN_USERNAME / ADMIN_PASSWORD</code> in your <code style={{ color: 'var(--text-accent)', fontFamily: 'var(--font-mono)' }}>.env</code> file.
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
