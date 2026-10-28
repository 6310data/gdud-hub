/** Small pieces shared by the ניהול פלוגה pages. Server-safe. */
import Link from "next/link";
import { Chip, tintStyle } from "@gdud/ui";
import { PROFILE_FIELD_LABEL } from "@gdud/core";
import { ActionButton } from "@/components/action-button";
import { Empty } from "@/components/page-parts";
import type { CompanyScope } from "@/lib/company/access";
import type { ChangeRequestRow, JoinRequestRow } from "@/lib/company/data";
import { fmtWhen } from "@/lib/logistics/format";
import { decideChange, decideJoin } from "../_actions/requests";

/** Company switcher, shown when the user covers more than one company. `path` follows the company id. */
export function CompanyPills({ companies, current, path = "" }: { companies: readonly CompanyScope[]; current: string; path?: string }) {
  if (companies.length < 2) return null;
  return (
    <nav className="tz-pills" aria-label="פלוגות">
      {companies.map(({ company: c }) => (
        <Link key={c.id} href={`/company/${c.id}${path}`} className="tz-pill" aria-current={c.id === current ? "page" : undefined}>
          <span aria-hidden="true" className="tz-dot" style={tintStyle(c.color)} />
          {c.name}
        </Link>
      ))}
    </nav>
  );
}

export function JoinRequests({ rows, place, now }: { rows: readonly JoinRequestRow[]; place: (unitId: string) => string; now: Date }) {
  if (!rows.length) return <Empty>אין בקשות הצטרפות פתוחות.</Empty>;
  return rows.map((r) => (
    <div key={r.id} className="flex flex-wrap items-center gap-3 border-b border-[var(--separator)] px-4 py-3 last:border-b-0">
      <span className="flex min-w-[200px] flex-1 flex-col">
        <span className="font-semibold">{r.personName ?? "חייל"}</span>
        <span className="tz-footnote">
          {place(r.unitId)} · {fmtWhen(r.createdAt, now)}
        </span>
        <span className="tz-footnote">
          חשבון Google: {r.displayName ? `${r.displayName} · ` : ""}
          <span className="tz-serial">{r.email}</span>
        </span>
      </span>
      <ActionButton action={decideJoin.bind(null, r.id, true)} label="אישור — זה הוא" variant="filled" />
      <ActionButton action={decideJoin.bind(null, r.id, false)} label="דחייה" confirmLabel="לדחות?" />
    </div>
  ));
}

export function ChangeRequests({ rows, place, now, selfId }: { rows: readonly ChangeRequestRow[]; place: (unitId: string) => string; now: Date; selfId: string | null }) {
  if (!rows.length) return <Empty>אין בקשות לעדכון פרטים.</Empty>;
  return rows.map((r) => (
    <div key={r.id} className="flex flex-wrap items-center gap-3 border-b border-[var(--separator)] px-4 py-3 last:border-b-0">
      <span className="flex min-w-[200px] flex-1 flex-col">
        <span className="font-semibold">
          {r.personName ?? "חייל"} <Chip tone="signed">{PROFILE_FIELD_LABEL[r.field]}</Chip>
        </span>
        <span className="text-[14px]">
          {r.oldValue || "ללא"} ← <b>{r.newValue || "ללא"}</b>
        </span>
        <span className="tz-footnote">
          {place(r.unitId)} · {fmtWhen(r.createdAt, now)}
          {r.field === "full_name" ? " · אחרי האישור דוח 1 וקשר יקבלו התראה לעדכן את הגיליונות" : ""}
        </span>
      </span>
      {r.personId === selfId ? (
        <span className="tz-footnote">בקשה שלך — מפקד אחר יאשר</span>
      ) : (
        <>
          <ActionButton action={decideChange.bind(null, r.id, true)} label="אישור" variant="filled" />
          <ActionButton action={decideChange.bind(null, r.id, false)} label="דחייה" confirmLabel="לדחות?" />
        </>
      )}
    </div>
  ));
}
