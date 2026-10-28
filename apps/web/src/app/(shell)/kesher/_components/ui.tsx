/** Small presentational pieces shared by the kesher screens (server-safe, no hooks). */
import Link from "next/link";
import { checkAge, type CheckStatus, type UnitNode } from "@gdud/core";
import { Chip, Icon, tintStyle } from "@gdud/ui";
import { leftCompany, type KPerson, type KSerial, type LastSeen } from "@/lib/kesher/data";
import { fmtCount, fmtDate } from "@/lib/logistics/format";

/** A company as the units tree names and colors it (ניהול מערכת › יחידות). */
export interface CompanyRef {
  name: string;
  color: string | null;
}

/** unit id → name and color, for every unit (a company that was renamed still finds its color). */
export const companyRefs = (units: readonly UnitNode[]): Map<string, CompanyRef> => new Map(units.map((u) => [u.id, { name: u.name, color: u.color }]));

/** The company's name in the company's color. */
export function CompanyChip({ company }: { company: CompanyRef }) {
  if (!company.color) return <Chip tone="signed">{company.name}</Chip>;
  return (
    <span className="tz-chip tz-chip-tint" style={tintStyle(company.color)}>
      {company.name}
    </span>
  );
}

/** A small dot in the company's color (pills, headings). */
export function CompanyDot({ color }: { color: string | null }) {
  return <span aria-hidden="true" className="tz-dot" style={tintStyle(color)} />;
}

/** במחסן / the company / ללא שיוך / הוחזר לחטיבה */
export function LocationChip({ serial, company }: { serial: Pick<KSerial, "location">; company?: CompanyRef | null }) {
  if (serial.location === "warehouse") return <Chip tone="ok">במחסן</Chip>;
  if (serial.location === "none") return <Chip tone="broken">ללא שיוך</Chip>;
  if (serial.location === "brigade") return <Chip tone="brigade">הוחזר לחטיבה</Chip>;
  return <CompanyChip company={company ?? { name: "פלוגה", color: null }} />;
}

/** The last דוח צ׳ of a company: לא הוגש / N לא נמצאו / ישן · N ימים / תקין */
export function ReportChip({ status }: { status: CheckStatus }) {
  if (status.kind === "none") return <Chip tone="broken">לא הוגש</Chip>;
  if (status.kind === "missing") return <Chip tone="broken">{status.missing} לא נמצאו</Chip>;
  if (status.kind === "stale") return <Chip tone="admin">ישן · {status.days} ימים</Chip>;
  return <Chip tone="ok">תקין</Chip>;
}

/** "היום" / "אתמול" / "לפני N ימים" */
export const daysAgo = (days: number) => (days === 0 ? "היום" : days === 1 ? "אתמול" : `לפני ${days} ימים`);

/**
 * How long ago a צ׳ was checked (a company דוח צ׳ or צהוב בעיניים), colored by checkAge: plain up
 * to warnDays, yellow after it, red after alertDays; never → `empty` (muted). Sorts by the date.
 */
export function AgeChip({
  at,
  now,
  warnDays,
  alertDays,
  by,
  empty = "לא נבדק",
}: {
  at: Date | null | undefined;
  now: Date;
  warnDays: number;
  alertDays: number;
  /** who checked, for the tooltip */
  by?: string | null;
  empty?: string;
}) {
  const { tone, days } = checkAge(at, now, warnDays, alertDays);
  if (!at || tone === "none")
    return (
      <span className="text-xs text-ink-muted" data-sort="">
        {empty}
      </span>
    );
  const title = [fmtDate(at), by].filter(Boolean).join(" · ");
  return (
    <span data-sort={at.toISOString()} title={title}>
      {tone === "ok" ? <span className="text-xs">{daysAgo(days)}</span> : <Chip tone={tone === "alert" ? "broken" : "admin"}>{daysAgo(days)}</Chip>}
    </span>
  );
}

/**
 * When a צ׳ was last seen in its company's דוח צ׳: "לא נמצא" (red) when the last report didn't find
 * it, otherwise an AgeChip colored by warnDays / alertDays (KesherData).
 */
export function SeenChip({ seen, now, warnDays, alertDays }: { seen: LastSeen | undefined; now: Date; warnDays: number; alertDays: number }) {
  if (seen && !seen.found)
    return (
      <span data-sort={seen.at.toISOString()} title={fmtDate(seen.at)}>
        <Chip tone="broken">לא נמצא</Chip>
      </span>
    );
  return <AgeChip at={seen?.at} now={now} warnDays={warnDays} alertDays={alertDays} />;
}

/** done/total with a small bar. */
export function Meter({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <span className="flex items-center gap-2">
      <span className="tz-meter w-[72px]" role="img" aria-label={`${done} מתוך ${total}`}>
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="tz-num text-xs text-ink-muted">
        {fmtCount(done)}/{fmtCount(total)}
      </span>
    </span>
  );
}

/** A soldier's name, with a warning when they no longer count as this company's. */
export function SoldierName({ person, unitId }: { person: KPerson | null; unitId: string }) {
  if (!person)
    return (
      <span className="text-ink-muted" data-sort="">
        לא משויך
      </span>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span>{person.name}</span>
      {leftCompany(person, unitId) ? <Chip tone="admin">{person.active ? "עבר פלוגה" : "הוסר מהרשימה"}</Chip> : null}
    </span>
  );
}

/** "פלס״ר" style link pills: one per company, with a count. */
export const pillCount = (n: number) => <span className="tz-pill-count">{fmtCount(n)}</span>;

/** A segmented control whose items are links (the state lives in the URL). */
export function SegLinks({ items, label }: { items: readonly { href: string; label: string; on: boolean }[]; label: string }) {
  return (
    <nav className="tz-seg w-full max-w-[360px]" aria-label={label}>
      {items.map((it) => (
        <Link key={it.href} href={it.href} className="tz-seg-item grid place-items-center text-ink no-underline" aria-current={it.on ? "page" : undefined} aria-selected={it.on}>
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

/** A search box that submits as a GET form; `keep` = other params to carry over. */
export function SearchBox({ action, q, placeholder, keep = {} }: { action: string; q?: string; placeholder: string; keep?: Record<string, string | undefined> }) {
  return (
    <form action={action} role="search" className="min-w-[220px] flex-1 lg:max-w-[320px]">
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <label className="tz-search bg-surface">
        <Icon name="search" size={15} />
        <input type="search" name="q" defaultValue={q} placeholder={placeholder} aria-label={placeholder} autoComplete="off" />
      </label>
    </form>
  );
}
