/** Small presentational pieces shared by the kesher screens (server-safe, no hooks). */
import Link from "next/link";
import type { CheckStatus, UnitNode } from "@gdud/core";
import { Chip, Icon, tintStyle } from "@gdud/ui";
import { leftCompany, type KPerson, type KSerial, type LastSeen } from "@/lib/kesher/data";
import { fmtCount } from "@/lib/logistics/format";

const DAY_MS = 86_400_000;

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

/** במחסן / the company / ללא שיוך */
export function LocationChip({ serial, company }: { serial: Pick<KSerial, "location">; company?: CompanyRef | null }) {
  if (serial.location === "warehouse") return <Chip tone="ok">במחסן</Chip>;
  if (serial.location === "none") return <Chip tone="broken">ללא שיוך</Chip>;
  return <CompanyChip company={company ?? { name: "פלוגה", color: null }} />;
}

/** The last דוח צ׳ of a company: לא הוגש / N לא נמצאו / ישן · N ימים / תקין */
export function ReportChip({ status }: { status: CheckStatus }) {
  if (status.kind === "none") return <Chip tone="broken">לא הוגש</Chip>;
  if (status.kind === "missing") return <Chip tone="broken">{status.missing} לא נמצאו</Chip>;
  if (status.kind === "stale") return <Chip tone="admin">ישן · {status.days} ימים</Chip>;
  return <Chip tone="ok">תקין</Chip>;
}

/** When a צ׳ was last seen in a דוח צ׳ (dimmed when older than staleDays). */
export function SeenChip({ seen, staleDays, now }: { seen: LastSeen | undefined; staleDays: number; now: Date }) {
  if (!seen) return <span className="text-xs text-ink-muted">לא נבדק</span>;
  if (!seen.found) return <Chip tone="broken">לא נמצא</Chip>;
  const days = Math.max(0, Math.floor((now.getTime() - seen.at.getTime()) / DAY_MS));
  return <span className={`text-xs ${days > staleDays ? "text-ink-muted" : ""}`}>{days === 0 ? "היום" : `לפני ${days} ימים`}</span>;
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
  if (!person) return <span className="text-ink-muted">לא משויך</span>;
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
