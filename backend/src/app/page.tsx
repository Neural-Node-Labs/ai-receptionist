export default function Page() {
  return (
    <div style={{ fontFamily: 'monospace', padding: '2rem', color: '#60a5fa', background: '#0a0e17', minHeight: '100vh' }}>
      <h1>AI Receptionist API</h1>
      <p><a href="/api/health" style={{ color: '#06b6d4' }}>→ /api/health</a></p>
      <p><a href="/api/providers" style={{ color: '#06b6d4' }}>→ /api/providers</a></p>
    </div>
  );
}
