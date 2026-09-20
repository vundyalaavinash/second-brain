export function ProgressRing({ percent, size = 36, stroke = 3, className = "" }: { percent: number; size?: number; stroke?: number; className?: string }) {
  const p = Math.max(0, Math.min(100, percent));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = p >= 100 ? "var(--color-success)" : "var(--color-accent)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${p}% done`} className={className}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - p / 100)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-300"
      />
    </svg>
  );
}
