'use client';

export function TypingIndicator() {
  return (
    <div className="animate-fade-in" style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', paddingLeft: '4px' }}>
      <div
        style={{
          padding: '10px 16px',
          borderRadius: 'var(--radius-lg) var(--radius-lg) var(--radius-lg) var(--radius-sm)',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          display: 'flex',
          gap: '5px',
          alignItems: 'center',
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--accent-blue)',
              display: 'inline-block',
              animation: `typing 1.2s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
