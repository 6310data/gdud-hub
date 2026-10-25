import Link from "next/link";
import type { Summary } from "@gdud/core";
import { Icon } from "@gdud/ui";
import { ReminderButton } from "./reminder-button";

export interface CompanySummary {
  unitId: string;
  name: string;
  summary: Summary;
}

const OK_COMPLETION = 0.9;

function Num({ n, strong, muted }: { n: number; strong?: boolean; muted?: boolean }) {
  return (
    <td className={`tz-num ${n ? "" : "tz-zero"} ${strong ? "font-semibold" : ""}`} style={muted && n ? { color: "var(--ink-muted)" } : undefined}>
      {n.toLocaleString("he-IL")}
    </td>
  );
}

function Completion({ value, bar = true }: { value: number; bar?: boolean }) {
  const pct = Math.round(value * 100);
  return (
    <td>
      <span className="flex items-center gap-2">
        {bar ? (
          <span className="h-1.5 min-w-14 flex-1 overflow-hidden rounded-full bg-fill">
            <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: value >= OK_COMPLETION ? "var(--tile-ok)" : "var(--bar-broken)" }} />
          </span>
        ) : null}
        <span className="tz-num tz-footnote min-w-[34px]">{pct}%</span>
      </span>
    </td>
  );
}

function MissingCell({ n }: { n: number }) {
  return (
    <td>
      {n ? (
        <span className="tz-chip tz-num" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
          {n}
        </span>
      ) : (
        <span className="tz-zero">0</span>
      )}
    </td>
  );
}

/** "מצב לפי פלוגה" (mockup 01): one row per company, a column per display group, a total row. */
export function CompanyTable({ rows, total, groupNames, isAdmin }: { rows: CompanySummary[]; total: Summary; groupNames: string[]; isAdmin: boolean }) {
  const groupCount = (s: Summary, name: string) => s.groups.find((g) => g.name === name)?.count ?? 0;
  return (
    <div className="tz-table-wrap">
      <table className="tz-table">
        <thead>
          <tr>
            <th>פלוגה</th>
            <th>ברשימה</th>
            <th>בסד״כ</th>
            {groupNames.map((g) => (
              <th key={g}>{g}</th>
            ))}
            <th>חסרי דיווח</th>
            <th className="min-w-[128px]">השלמת דיווח</th>
            <th aria-label="פעולות" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.unitId} className="tz-hover">
              <th scope="row" className="font-semibold">
                <Link href={`/doch1/today?unit=${r.unitId}`} className="tz-cell-link">
                  {r.name}
                </Link>
              </th>
              <Num n={r.summary.roster} muted />
              <Num n={r.summary.inSadak} strong />
              {groupNames.map((g) => (
                <Num key={g} n={groupCount(r.summary, g)} />
              ))}
              <MissingCell n={r.summary.missing} />
              <Completion value={r.summary.completion} />
              <td>
                <span className="flex items-center justify-end gap-1">
                  {isAdmin && r.summary.missing ? <ReminderButton unitId={r.unitId} name={r.name} /> : null}
                  <Link
                    href={`/doch1/today?unit=${r.unitId}`}
                    aria-label={`דוח 1 של ${r.name}`}
                    className="grid size-8 place-items-center rounded-lg text-[var(--chevron)] hover:bg-fill"
                  >
                    <Icon name="chevron" size={17} />
                  </Link>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">סה״כ גדוד</th>
            <Num n={total.roster} />
            <Num n={total.inSadak} />
            {groupNames.map((g) => (
              <Num key={g} n={groupCount(total, g)} />
            ))}
            <MissingCell n={total.missing} />
            <Completion value={total.completion} bar={false} />
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
