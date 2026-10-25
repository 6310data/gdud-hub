import type { Summary } from "@gdud/core";

/** "איפה כולם היום": display groups + missing, as shares of everyone reported or missing (mockup 01 / 06). */
export function CompositionBar({ summary, scopeName }: { summary: Summary; scopeName: string }) {
  const total = summary.reported + summary.missing;
  const segments = [
    ...summary.groups.map((g) => ({ key: g.name, label: g.name, n: g.count, color: g.color })),
    // reported with a status that is not counted in the סד״כ (e.g. "0" / לא בשמ״פ)
    { key: "out", label: "לא בסד״כ", n: summary.reported - summary.inSadak, color: "var(--line-strong)" },
    { key: "missing", label: "חסרי דיווח", n: summary.missing, color: "var(--danger)" },
  ].filter((s) => s.n > 0);
  const share = (n: number) => `${total ? Math.round((n / total) * 100) : 0}%`;
  return (
    <section className="tz-card flex flex-col gap-3 p-4 lg:p-[18px]" aria-label="חלוקת הסד״כ היום">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="tz-headline">איפה כולם היום · {scopeName}</h2>
        <span className="tz-footnote">
          <span className="tz-num">{total.toLocaleString("he-IL")}</span> שאמורים לדווח היום
        </span>
      </div>
      <div className="flex h-3.5 gap-[3px] overflow-hidden rounded-full bg-fill" role="img" aria-label={segments.map((s) => `${s.label} ${s.n}`).join(", ")}>
        {segments.map((s) => (
          <span key={s.key} className="h-full min-w-1 rounded-full" style={{ flex: `${s.n} 1 0`, background: s.color }} />
        ))}
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-x-[22px] gap-y-2 p-0 text-[14px]">
        {segments.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-[7px]">
            <span aria-hidden="true" className="size-2.5 flex-none rounded-[3px]" style={{ background: s.color }} />
            {s.label}
            <strong className="tz-num font-semibold">{s.n.toLocaleString("he-IL")}</strong>
            <span className="tz-footnote tz-num">{share(s.n)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
