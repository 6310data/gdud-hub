import Link from "next/link";
import type { Summary } from "@gdud/core";
import { ReminderButton } from "./reminder-button";

export interface CompanySummary {
  unitId: string;
  name: string;
  summary: Summary;
}

const OK_COMPLETION = 0.9;

function Num({ n }: { n: number }) {
  return <td className={`tz-num ${n ? "" : "tz-zero"}`}>{n.toLocaleString("he-IL")}</td>;
}

function Completion({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <td>
      <span className="flex items-center gap-2">
        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-fill">
          <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: value >= OK_COMPLETION ? "var(--tile-ok)" : "var(--primary)" }} />
        </span>
        <span className="tz-num">{pct}%</span>
      </span>
    </td>
  );
}

function MissingCell({ n }: { n: number }) {
  return (
    <td>
      {n ? (
        <span className="tz-chip" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
          {n}
        </span>
      ) : (
        <span className="tz-zero">0</span>
      )}
    </td>
  );
}

/** "מצב לפי פלוגה": one row per company, columns per display group, a total row. */
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
            <th>השלמת דיווח</th>
            {isAdmin ? <th aria-label="תזכורת" /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.unitId}>
              <th scope="row" className="font-semibold">
                <Link href={`/doch1/today?unit=${r.unitId}`}>{r.name}</Link>
              </th>
              <Num n={r.summary.roster} />
              <Num n={r.summary.inSadak} />
              {groupNames.map((g) => (
                <Num key={g} n={groupCount(r.summary, g)} />
              ))}
              <MissingCell n={r.summary.missing} />
              <Completion value={r.summary.completion} />
              {isAdmin ? <td>{r.summary.missing ? <ReminderButton unitId={r.unitId} name={r.name} /> : null}</td> : null}
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
            <Completion value={total.completion} />
            {isAdmin ? <td /> : null}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
