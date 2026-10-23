import type { Summary } from "@gdud/core";
import { StatusDot } from "./status-chip";

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

/** בסד״כ, one card per display group, חסרי דיווח (mockup screens 01 / 06). */
export function KpiRow({ summary }: { summary: Summary }) {
  return (
    <div className="tz-card grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
      <div className="tz-kpi">
        <span>
          <span className="tz-kpi-value tz-num">{summary.inSadak.toLocaleString("he-IL")}</span>
          <span className="tz-kpi-label">בסד״כ · מתוך {summary.roster.toLocaleString("he-IL")} ברשימה</span>
        </span>
      </div>
      {summary.groups.map((g) => (
        <div key={g.name} className="tz-kpi">
          <StatusDot color={g.color} />
          <span>
            <span className="tz-kpi-value tz-num">{g.count.toLocaleString("he-IL")}</span>
            <span className="tz-kpi-label">
              {g.name} · {pct(g.count, summary.inSadak)}% מהסד״כ
            </span>
          </span>
        </div>
      ))}
      <div className="tz-kpi">
        <span>
          <span className="tz-kpi-value tz-num" style={{ color: summary.missing ? "var(--danger)" : undefined }}>
            {summary.missing.toLocaleString("he-IL")}
          </span>
          <span className="tz-kpi-label">חסרי דיווח</span>
        </span>
      </div>
    </div>
  );
}
