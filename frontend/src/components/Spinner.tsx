export function Spinner({ label }: { label?: string }) {
  return (
    <div className="center mt mb" style={{ color: 'var(--muted)' }}>
      <div
        style={{
          width: 26,
          height: 26,
          border: '3px solid var(--line)',
          borderTopColor: 'var(--accent)',
          borderRadius: '50%',
          margin: '0 auto 10px',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      {label ?? 'Loading…'}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}