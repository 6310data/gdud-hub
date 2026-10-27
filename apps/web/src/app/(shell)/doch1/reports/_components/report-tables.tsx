import Link from "next/link";
import type { ReactNode } from "react";
import {
  DATA_CHECK_LABEL,
  DATA_CHECKS,
  type CampReport,
  type ControlRow,
  type CriticalRoles,
  type DataCheck,
  type ListedSoldier,
  type LocationKind,
  type OutpostReport,
  type ReportCompany,
  type ReportLocation,
  type ReportSummary,
  type SadakTable,
  type StatusDef,
} from "@gdud/core";
import { Icon, Serial } from "@gdud/ui";
import type { ReportPerson } from "@/lib/doch1/reports";
import { StatusChip } from "../../_components/status-chip";

const fmt = (n: number) => n.toLocaleString("he-IL");

/** A count cell: zero is greyed (as in the mockup). */
function Num({ n, strong, tone }: { n: number; strong?: boolean; tone?: "border" | "camp" }) {
  const color = n && tone === "border" ? "var(--status-broken)" : n && tone === "camp" ? "var(--status-ok)" : undefined;
  return (
    <td className={`tz-num ${n ? "" : "tz-zero"} ${strong ? "font-semibold" : ""}`} style={color ? { color } : undefined}>
      {fmt(n)}
    </td>
  );
}

/** A data-control count: red and linked to the soldiers when not zero. */
function Flag({ n, check }: { n: number; check: DataCheck }) {
  return (
    <td>
      {n ? (
        <a href={`#check-${check}`} className="tz-chip tz-num" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
          {fmt(n)}
        </a>
      ) : (
        <span className="tz-zero tz-num">0</span>
      )}
    </td>
  );
}

const LOCATION_TONE: Record<LocationKind, { background: string; color: string }> = {
  outpost: { background: "var(--status-broken-soft)", color: "var(--status-broken)" },
  camp: { background: "var(--status-ok-soft)", color: "var(--status-ok)" },
  outside: { background: "var(--status-signed-soft)", color: "var(--status-signed)" },
};

function LocationChip({ location }: { location: ReportLocation }) {
  return (
    <span className="tz-chip" style={LOCATION_TONE[location.kind]}>
      {location.name}
    </span>
  );
}

export function ReportSection({ id, title, note, children, footer, className }: { id: string; title: string; note?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <section id={id} className={`flex min-w-0 scroll-mt-6 flex-col gap-1.5 ${className ?? ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4">
        <h2 className="text-[20px] font-bold leading-[26px]">{title}</h2>
        {note ? <span className="tz-footnote">{note}</span> : null}
      </div>
      {children}
      {footer ? <p className="tz-section-footer">{footer}</p> : null}
    </section>
  );
}

/* ── summary ── */

function SummaryCard({ label, value, of, foot, tone }: { label: string; value: number; of?: number; foot: string; tone?: "border" | "camp" }) {
  const color = tone === "border" ? "var(--status-broken)" : tone === "camp" ? "var(--status-ok)" : undefined;
  return (
    <div className="tz-card flex min-w-0 flex-col gap-1.5 p-4">
      <span className="tz-footnote truncate">{label}</span>
      <span className="tz-num text-[30px] font-bold leading-9 tracking-[-0.02em]" style={color ? { color } : undefined}>
        {fmt(value)}
        {of !== undefined ? <span className="text-[18px] text-ink-muted">/{fmt(of)}</span> : null}
      </span>
      <span className="tz-footnote truncate">{foot}</span>
    </div>
  );
}

export function SummaryCards({ summary, outposts, listedLabel }: { summary: ReportSummary; outposts: readonly ReportLocation[]; listedLabel: string | null }) {
  return (
    <section aria-label="סיכום" className="grid grid-cols-2 gap-3 lg:grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
      <SummaryCard label="שמ״פ" value={summary.onDuty} foot="לפי דוח 1, בלי חסרי דיווח" />
      <SummaryCard label="כ״א מתפקד בגזרה" value={summary.inSector} foot="מוצבים ומחנות" />
      <SummaryCard label="מעבר לגבול" value={summary.acrossBorder} foot={outposts.map((o) => o.name).join(" ו") || "אין מוצבים בהגדרות"} tone="border" />
      {summary.camps.map((c) => (
        <SummaryCard key={c.location.id} label={c.location.name} value={c.count} foot="לפי הסטטוס היום" tone="camp" />
      ))}
      {listedLabel ? <SummaryCard label={`${listedLabel} זמינים`} value={summary.listedAvailable} of={summary.listedTotal} foot="לפי ״זמין לכוננות״" /> : null}
    </section>
  );
}

/* ── R1 ── */

export function CriticalRolesTable({ data, companies, locations }: { data: CriticalRoles; companies: readonly ReportCompany[]; locations: readonly ReportLocation[] }) {
  const company = new Map(companies.map((c) => [c.id, c.name]));
  const location = new Map(locations.map((l) => [l.id, l]));
  if (!data.rows.length) return <Empty>אין חיילים במוצבים או במחנות ביום הזה.</Empty>;
  return (
    <div className="tz-table-wrap">
      <table className="tz-table">
        <thead>
          <tr>
            <th>פלוגה</th>
            <th>מיקום</th>
            {data.columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
            <th className="border-s border-separator">סה״כ</th>
            <th className="border-s border-separator">מעבר לגבול</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={`${r.companyId}|${r.locationId}`}>
              <th scope="row" className="font-semibold">
                {company.get(r.companyId)}
              </th>
              <td>
                <LocationChip location={location.get(r.locationId)!} />
              </td>
              {r.counts.map((n, i) => (
                <Num key={data.columns[i]} n={n} />
              ))}
              <td className="tz-num border-s border-separator font-semibold">{fmt(r.total)}</td>
              <td className={`tz-num border-s border-separator font-semibold ${r.acrossBorder ? "" : "tz-zero"}`} style={r.acrossBorder ? { color: "var(--status-broken)" } : undefined}>
                {fmt(r.acrossBorder)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">סה״כ</th>
            <td />
            {data.total.counts.map((n, i) => (
              <td key={data.columns[i]} className="tz-num">
                {fmt(n)}
              </td>
            ))}
            <td className="tz-num border-s border-separator">{fmt(data.total.total)}</td>
            <td className="tz-num border-s border-separator" style={{ color: "var(--status-broken)" }}>
              {fmt(data.total.acrossBorder)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* ── R2: 15א ── */

export function OutpostTable({ data, companies, needsOutpostLabel }: { data: OutpostReport; companies: readonly ReportCompany[]; needsOutpostLabel: string }) {
  const company = new Map(companies.map((c) => [c.id, c.name]));
  return (
    <div className="tz-table-wrap">
      <table className="tz-table">
        <thead>
          <tr>
            <th>פלוגה</th>
            {data.outposts.map((o) => (
              <th key={o.id}>{o.name}</th>
            ))}
            <th>סה״כ {needsOutpostLabel}</th>
            {data.camps.map((c) => (
              <th key={c.id}>{c.name}</th>
            ))}
            <th>סה״כ</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.companyId} style={r.noOutpost > 0 ? { background: "var(--danger-soft)" } : undefined}>
              <th scope="row" className="font-semibold">
                {company.get(r.companyId)}
              </th>
              {r.outposts.map((n, i) => (
                <Num key={data.outposts[i]!.id} n={n} />
              ))}
              <td>
                <span className="flex items-center gap-2">
                  <span className={`tz-num font-semibold ${r.needsOutpost ? "" : "tz-zero"}`} style={r.needsOutpost ? { color: "var(--status-broken)" } : undefined}>
                    {fmt(r.needsOutpost)}
                  </span>
                  {r.noOutpost > 0 ? (
                    <a href="#check-outpostStatusNoOutpost" className="tz-chip" style={{ background: "var(--surface-100)", color: "var(--danger)" }}>
                      <span className="tz-num">{fmt(r.noOutpost)}</span> ללא מוצב
                    </a>
                  ) : null}
                </span>
              </td>
              {r.camps.map((n, i) => (
                <Num key={data.camps[i]!.id} n={n} tone="camp" />
              ))}
              <Num n={r.total} strong />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">סה״כ</th>
            {data.total.outposts.map((n, i) => (
              <td key={data.outposts[i]!.id} className="tz-num">
                {fmt(n)}
              </td>
            ))}
            <td className="tz-num">{fmt(data.total.needsOutpost)}</td>
            {data.total.camps.map((n, i) => (
              <td key={data.camps[i]!.id} className="tz-num">
                {fmt(n)}
              </td>
            ))}
            <td className="tz-num">{fmt(data.total.total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* ── R3: 10א ── */

export function CampList({ data }: { data: CampReport }) {
  const max = Math.max(1, ...data.rows.map((r) => r.count), data.unassigned);
  const rows = data.unassigned ? [...data.rows, { name: "יחידה ללא שיוך", commander: null, count: data.unassigned }] : data.rows;
  return (
    <div className="tz-group">
      {rows.map((r) => (
        <div key={r.name} className="tz-row">
          <span className="tz-row-body gap-3">
            <span className="flex w-[128px] flex-none flex-col">
              <span className="truncate text-[15px]">{r.name}</span>
              {r.commander ? <span className="tz-footnote truncate">{r.commander}</span> : null}
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-fill">
              <span className="block h-2 rounded-full" style={{ width: `${(r.count / max) * 100}%`, background: "var(--status-ok)" }} />
            </span>
            <span className="tz-num w-9 text-end font-semibold" style={r.count ? undefined : { color: "var(--chevron)" }}>
              {fmt(r.count)}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── R4: the listed category (מט״בים) ── */

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("");

export function ListedList({
  rows,
  people,
  statuses,
  back,
}: {
  rows: readonly ListedSoldier[];
  people: ReadonlyMap<string, ReportPerson>;
  statuses: readonly StatusDef[];
  back: string;
}) {
  const byId = new Map(statuses.map((s) => [s.id, s]));
  if (!rows.length) return <Empty>אין חיילים בקטגוריה הזו ביום הזה.</Empty>;
  return (
    <div className="tz-group">
      {rows.map((r) => {
        const p = people.get(r.personId);
        return (
          <Link key={r.personId} href={soldierHref(r.personId, back)} className="tz-row">
            <span className="tz-avatar">{initials(p?.name ?? "")}</span>
            <span className="tz-row-body">
              <span className="tz-row-title">
                {p?.name}
                <span className="tz-row-sub">{[p?.platoon ?? p?.company, p?.location ?? "לא בשבצ״ק"].filter(Boolean).join(" · ")}</span>
              </span>
              <StatusChip status={r.statusId ? byId.get(r.statusId) : null} />
              <Icon name="chevron" size={17} className="tz-chevron" />
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/* ── R5: data control per company ── */

export function ControlTable({ rows, companies }: { rows: readonly ControlRow[]; companies: readonly ReportCompany[] }) {
  const company = new Map(companies.map((c) => [c.id, c.name]));
  return (
    <div className="tz-table-wrap">
      <table className="tz-table">
        <thead>
          <tr>
            <th>פלוגה</th>
            <th>ברשימה</th>
            <th>לא בשמ״פ</th>
            <th>חסרי דיווח</th>
            <th>בשמ״פ</th>
            <th>דורש מוצב ללא מוצב</th>
            <th>במוצב בסטטוס אחר</th>
            <th>בשבצ״ק</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.companyId}>
              <th scope="row" className="font-semibold">
                {company.get(r.companyId)}
              </th>
              <Num n={r.rows} />
              <Num n={r.offDuty} />
              <Flag n={r.missing} check="missing" />
              <Num n={r.onDuty} strong />
              <Flag n={r.noOutpost} check="outpostStatusNoOutpost" />
              <Flag n={r.atOutpostOther} check="atOutpostOtherStatus" />
              <td className="tz-num" style={{ color: "var(--ink-muted)" }}>
                {fmt(r.inShabzak)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── data checks ── */

/** Lists longer than this start closed. */
const OPEN_UP_TO = 12;

const soldierHref = (personId: string, back: string) => `/doch1/soldiers/${personId}?back=${encodeURIComponent(back)}`;

export function DataChecks({
  checks,
  people,
  statuses,
  dayStatuses,
  back,
}: {
  checks: Record<DataCheck, string[]>;
  people: ReadonlyMap<string, ReportPerson>;
  statuses: readonly StatusDef[];
  dayStatuses: ReadonlyMap<string, string>;
  back: string;
}) {
  const byId = new Map(statuses.map((s) => [s.id, s]));
  return (
    <div className="tz-group">
      {DATA_CHECKS.map((k) => {
        const ids = checks[k];
        return (
          <details key={k} id={`check-${k}`} open={ids.length > 0 && ids.length <= OPEN_UP_TO} className="group scroll-mt-6 border-b border-separator last:border-b-0">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <span className="flex-1 font-semibold">{DATA_CHECK_LABEL[k]}</span>
              {ids.length ? (
                <span className="tz-chip tz-num" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
                  {fmt(ids.length)}
                </span>
              ) : (
                <span className="tz-chip" style={{ background: "var(--status-ok-soft)", color: "var(--status-ok)" }}>
                  תקין
                </span>
              )}
              {ids.length ? <Icon name="chevron" size={17} className="tz-chevron transition-transform group-open:-rotate-90" /> : null}
            </summary>
            {ids.length ? (
              <ul className="m-0 list-none bg-ground/60 p-0">
                {ids.map((id) => {
                  const p = people.get(id);
                  const st = dayStatuses.get(id);
                  return (
                    <li key={id} className="border-t border-separator">
                      <Link href={soldierHref(id, back)} className="flex min-h-11 items-center gap-3 px-4 py-2 text-ink no-underline hover:bg-fill">
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{p?.name}</span>
                          <span className="tz-footnote truncate">{[p?.company, p?.platoon, p?.location].filter(Boolean).join(" · ")}</span>
                        </span>
                        {k === "duplicateNumber" && p?.personalNumber ? <Serial>{p.personalNumber}</Serial> : null}
                        {st ? <StatusChip status={byId.get(st)} /> : k === "missing" ? <StatusChip status={null} /> : null}
                        <Icon name="chevron" size={15} className="tz-chevron" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </details>
        );
      })}
    </div>
  );
}

/* ── F: סד״כ per מסגרת ── */

export function SadakByPlatoon({
  data,
  companies,
  platoonNames,
}: {
  data: SadakTable;
  companies: readonly ReportCompany[];
  platoonNames: ReadonlyMap<string, string>;
}) {
  const { outposts, statuses } = data.columns;
  const width = 1 + outposts.length + 1 + statuses.length + 2;
  return (
    <div className="tz-table-wrap">
      <table className="tz-table">
        <thead>
          <tr>
            <th>מסגרת</th>
            {outposts.map((o) => (
              <th key={o.id}>{o.name}</th>
            ))}
            <th>ללא מוצב</th>
            {statuses.map((s) => (
              <th key={s.name}>{s.name}</th>
            ))}
            <th>חסר דיווח</th>
            <th className="border-s border-separator">סה״כ</th>
          </tr>
        </thead>
        <tbody>
          {companies.map((c) => {
            const rows = data.rows.filter((r) => r.companyId === c.id);
            if (!rows.length) return null;
            return [
              <tr key={c.id} className="tz-group-row">
                <th colSpan={width}>{c.name}</th>
              </tr>,
              ...rows.map((r) => (
                <tr key={`${c.id}|${r.platoonId}`}>
                  <th scope="row">{r.platoonId ? platoonNames.get(r.platoonId) : "ברמת הפלוגה"}</th>
                  {r.outposts.map((n, i) => (
                    <Num key={outposts[i]!.id} n={n} tone="border" />
                  ))}
                  <Num n={r.noOutpost} />
                  {r.statuses.map((n, i) => (
                    <Num key={statuses[i]!.name} n={n} />
                  ))}
                  <Num n={r.missing} />
                  <td className="tz-num border-s border-separator font-semibold">{fmt(r.total)}</td>
                </tr>
              )),
            ];
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">סה״כ</th>
            {data.total.outposts.map((n, i) => (
              <td key={outposts[i]!.id} className="tz-num">
                {fmt(n)}
              </td>
            ))}
            <td className="tz-num">{fmt(data.total.noOutpost)}</td>
            {data.total.statuses.map((n, i) => (
              <td key={statuses[i]!.name} className="tz-num">
                {fmt(n)}
              </td>
            ))}
            <td className="tz-num">{fmt(data.total.missing)}</td>
            <td className="tz-num border-s border-separator">{fmt(data.total.total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="tz-card m-0 px-4 py-5 text-center text-[15px] text-ink-muted">{children}</p>;
}
