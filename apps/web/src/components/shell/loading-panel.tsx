export function LoadingPanel({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label={label}>
      <p className="pw-kicker">{label}</p>
      <div className="pw-metric-row">
        <div className="pw-metric">
          <div className="pw-skeleton h-3 w-16" />
          <div className="pw-skeleton mt-2 h-5 w-24" />
        </div>
        <div className="pw-metric">
          <div className="pw-skeleton h-3 w-20" />
          <div className="pw-skeleton mt-2 h-5 w-20" />
        </div>
        <div className="pw-metric">
          <div className="pw-skeleton h-3 w-14" />
          <div className="pw-skeleton mt-2 h-5 w-16" />
        </div>
        <div className="pw-metric">
          <div className="pw-skeleton h-3 w-16" />
          <div className="pw-skeleton mt-2 h-5 w-10" />
        </div>
      </div>
      <div className="pw-skeleton h-8" />
      <div className="pw-skeleton h-36" />
    </div>
  );
}
