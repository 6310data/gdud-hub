import type { Summary } from "@gdud/core";
import { StatusDot } from "./status-chip";

/** "איפה כולם היום": display groups + missing, as shares of everyone reported or missing. */
export function CompositionBar({ summary }: { summary: Summary }) {
  const total = summary.reported + summary.missing;
  const segments = [
    ...summary.groups.map((g) => ({ key: g.name, label: g.name, n: g.count, color: g.color })),
    { key: "missing", label: "חסרי דיווח", n: summary.missing, color: "var(--danger)" },
  ].filter((s) => s.n > 0);
  const w = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-fill" role="img" aria-label={segments.map((s) => `${s.label} ${s.n}`).join(", ")}>
        {segments.map((s) => (
          <span key={s.key} className="h-full min-w-[3px]" style={{ width: w(s.n), background: s.color }} />
        ))}
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0 text-[13px]">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <StatusDot color={s.color} size={10} />
            {s.label} <span className="tz-num font-semibold">{s.n.toLocaleString("he-IL")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
