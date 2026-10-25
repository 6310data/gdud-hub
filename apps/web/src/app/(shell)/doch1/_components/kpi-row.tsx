import type { Summary } from "@gdud/core";

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

function KpiCard({ color, label, value, foot, danger }: { color: string; label: string; value: number; foot: string; danger?: boolean }) {
  return (
    <div className="tz-card flex min-w-0 flex-col gap-2 p-4 lg:p-[18px]">
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className="size-3 flex-none rounded-[4px]" style={{ background: color }} />
        <span className="truncate text-[14px] font-medium text-ink-muted">{label}</span>
      </span>
      <span className="tz-num text-[34px] font-bold leading-10 tracking-[-0.02em]" style={danger && value ? { color: "var(--danger)" } : undefined}>
        {value.toLocaleString("he-IL")}
      </span>
      <span className="tz-footnote">{foot}</span>
    </div>
  );
}

/** בסד״כ, one card per display group, חסרי דיווח (mockup screens 01 / 06). */
export function KpiRow({ summary }: { summary: Summary }) {
  return (
    <section aria-label="מדדי היום" className="grid grid-cols-2 gap-3 lg:grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
      <KpiCard color="var(--primary)" label="בסד״כ היום" value={summary.inSadak} foot={`מתוך ${summary.roster.toLocaleString("he-IL")} ברשימה`} />
      {summary.groups.map((g) => (
        <KpiCard key={g.name} color={g.color} label={g.name} value={g.count} foot={`${pct(g.count, summary.inSadak)}% מהסד״כ`} />
      ))}
      <KpiCard color="var(--danger)" label="חסרי דיווח" value={summary.missing} foot="ברשימה ואין להם סטטוס היום" danger />
    </section>
  );
}
