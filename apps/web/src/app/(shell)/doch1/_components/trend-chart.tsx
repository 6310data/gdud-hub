export interface TrendPoint {
  day: string;
  /** "19.10" */
  label: string;
  isToday: boolean;
  /** the number over the column (בסד״כ) */
  total: number;
  segments: Array<{ key: string; color: string; n: number }>;
}

const BAR_AREA = 150;

/** "סד״כ לפי מיקום" (mockup 01): one stacked column per sampled day, oldest first (RTL: today ends the row on the left). */
export function TrendChart({ points, legend }: { points: TrendPoint[]; legend: Array<{ key: string; label: string; color: string }> }) {
  const heights = points.map((p) => p.segments.reduce((n, s) => n + s.n, 0));
  const max = Math.max(1, ...heights);
  return (
    <section className="tz-card flex min-w-0 flex-col gap-3.5 p-4 lg:p-[18px]" aria-label="סד״כ לפי מיקום">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
        <h2 className="tz-headline">סד״כ לפי מיקום · {points.length > 1 ? `${points.length} ימים` : "היום"}</h2>
        <ul className="m-0 flex list-none flex-wrap gap-x-3.5 gap-y-1 p-0 text-[12px] text-ink-muted">
          {legend.map((l) => (
            <li key={l.key} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2 rounded-[2px]" style={{ background: l.color }} />
              {l.label}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex items-end gap-1.5 overflow-x-auto pb-0.5" role="img" aria-label="סד״כ בכל יום מדוגם, לפי קבוצות תצוגה">
        {points.map((p, i) => (
          <div key={p.day} className="flex min-w-6 flex-1 flex-col items-center gap-1">
            <span className={`tz-num text-[11px] ${p.isToday ? "font-bold text-ink" : "text-ink-muted"}`}>{p.total}</span>
            <div className="flex w-full flex-col-reverse overflow-hidden rounded-[4px]" style={{ height: Math.round((heights[i]! / max) * BAR_AREA) }}>
              {p.segments.map((s) =>
                s.n ? <span key={s.key} className="block w-full" style={{ flex: `${s.n} 1 0`, background: s.color, minHeight: 2 }} /> : null,
              )}
            </div>
            <span className={`tz-num text-[11px] ${p.isToday ? "font-bold text-ink" : "text-ink-muted"}`}>{p.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
