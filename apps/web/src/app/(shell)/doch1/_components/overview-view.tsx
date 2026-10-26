import Link from "next/link";
import type { Day, Summary } from "@gdud/core";
import { Icon } from "@gdud/ui";
import { AttentionList, type MissingByCompany } from "./attention-list";
import { CompanyTable, type CompanySummary } from "./company-table";
import { CompositionBar } from "./composition-bar";
import { DayNav } from "./day-nav";
import { KpiRow } from "./kpi-row";
import { TrendChart, type TrendPoint } from "./trend-chart";

export interface OverviewProps {
  dateLine: string;
  dayNav: { day: Day; today: Day; min: Day; max: Day; params: Record<string, string | null> };
  /** "היום" or "ב־19.10" */
  when: string;
  /** "" for today, else "&day=…" for links that keep the shown day */
  dayQuery: string;
  rows: CompanySummary[];
  total: Summary;
  scope: string | null;
  missing: MissingByCompany[];
  trend: TrendPoint[];
  isAdmin: boolean;
  canCopy: boolean;
}

/** Battalion overview (mockup screens 01 / 06). Presentational: the page loads the data. */
export function OverviewView({ dateLine, dayNav, when, dayQuery, rows, total, scope, missing, trend, isAdmin, canCopy }: OverviewProps) {
  const scoped = scope ? rows.find((r) => r.unitId === scope)! : null;
  const summary = scoped?.summary ?? total;
  const legend = [
    ...total.groups.map((g) => ({ key: g.name, label: g.name, color: g.color })),
    { key: "out", label: "לא בסד״כ / לא דווח", color: "var(--line-strong)" },
  ];

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="tz-footnote">{dateLine}</span>
          <h1 className="tz-large-title">סקירה גדודית</h1>
          <DayNav {...dayNav} path="/doch1" />
        </div>
        <div className="flex flex-wrap items-center gap-2 max-lg:hidden">
          {canCopy ? (
            <Link href={`/doch1/copy${dayQuery.replace("&", "?")}`} className="tz-btn tz-btn-tinted min-h-10 text-[15px]">
              העתקה לגיליון
            </Link>
          ) : null}
          {isAdmin ? (
            <Link href={`/doch1/brigade${dayQuery.replace("&", "?")}`} className="tz-btn tz-btn-filled min-h-10 text-[15px]">
              <Icon name="send" size={17} />
              דוח לחטיבה
            </Link>
          ) : null}
        </div>
      </header>

      <nav className="tz-pills pb-0.5" aria-label="סינון לפי פלוגה">
        <Link href={`/doch1${dayQuery.replace("&", "?")}`} className="tz-pill" aria-current={scope ? undefined : "page"}>
          כל הגדוד <span className="tz-pill-count tz-num">{total.roster}</span>
        </Link>
        {rows.map((r) => (
          <Link key={r.unitId} href={`/doch1?unit=${r.unitId}${dayQuery}`} className="tz-pill" aria-current={scope === r.unitId ? "page" : undefined}>
            {r.name} <span className="tz-pill-count tz-num">{r.summary.roster}</span>
          </Link>
        ))}
      </nav>

      <KpiRow summary={summary} when={when} />

      <CompositionBar summary={summary} scopeName={scoped?.name ?? "כל הגדוד"} when={when} />

      <div className="flex flex-wrap items-start gap-[18px]">
        <section className="flex min-w-0 flex-[2_1_560px] flex-col gap-1.5">
          <h2 className="tz-section-header">מצב לפי פלוגה</h2>
          <CompanyTable rows={rows} total={total} groupNames={total.groups.map((g) => g.name)} isAdmin={isAdmin} dayQuery={dayQuery} />
          <p className="tz-section-footer">פלוגה שאינה פעילה בסבב אינה נספרת. ״לא בסד״כ״ הם מי שדווחו בסטטוס שלא נספר בסד״כ.</p>
        </section>
        <section className="flex min-w-0 flex-[1_1_320px] flex-col gap-1.5">
          <h2 className="tz-section-header">דורש טיפול {when}</h2>
          <AttentionList items={missing} when={when} dayQuery={dayQuery} />
          <p className="tz-section-footer">לחיצה על פלוגה פותחת את דוח 1 שלה {dayQuery ? "ליום הזה" : "להיום"}.</p>
        </section>
      </div>

      {trend.length > 1 ? <TrendChart points={trend} legend={legend} /> : null}
    </>
  );
}
