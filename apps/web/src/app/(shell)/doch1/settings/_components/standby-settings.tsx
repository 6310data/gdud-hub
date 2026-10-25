"use client";
import type { ReactNode } from "react";
import {
  LOCATION_KIND_LABEL,
  LOCATION_KINDS,
  STANDBY_LEVEL_LABEL,
  STANDBY_LEVELS,
  VEHICLE_STATE_LABEL,
  VEHICLE_STATES,
  type LocationKind,
  type StandbyLevel,
  type VehicleState,
} from "@gdud/core";
import { Icon, Serial } from "@gdud/ui";
import { ActionForm } from "@/components/action-form";
import { saveLocation, saveStandbyType, saveVehicle } from "../../_actions/settings";

type Action = Parameters<typeof ActionForm>[0]["action"];

/** One collapsible settings row (as in the status editor): a summary line, opened to edit. */
function EditRow({ summary, action, children }: { summary: ReactNode; action: Action; children: ReactNode }) {
  return (
    <details className="group border-b border-separator last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        {summary}
        <Icon name="chevron" size={17} className="tz-chevron transition-transform group-open:-rotate-90" />
      </summary>
      <ActionForm action={action} submitLabel="שמירה" variant="tinted" className="flex flex-col items-start gap-3 bg-ground/60 px-4 pb-4 pt-2">
        {children}
      </ActionForm>
    </details>
  );
}

function AddRow({ label, action, children }: { label: string; action: Action; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 font-semibold text-primary [&::-webkit-details-marker]:hidden">
        <Icon name="plus" size={18} />
        {label}
      </summary>
      <ActionForm action={action} submitLabel={label} variant="filled" className="flex flex-col items-start gap-3 px-4 pb-4 pt-2">
        {children}
      </ActionForm>
    </details>
  );
}

function Active({ on }: { on: boolean }) {
  return (
    <label className="flex items-center gap-2 text-[14px] font-semibold">
      פעיל
      <input type="checkbox" role="switch" name="active" defaultChecked={on} />
    </label>
  );
}

function Sort({ value }: { value: number }) {
  return (
    <label className="tz-field">
      <span className="tz-label">סדר</span>
      <input className="tz-input min-h-9 w-[72px]" type="number" name="sortOrder" min={0} max={999} defaultValue={value} />
    </label>
  );
}

const inactive = (on: boolean) => (on ? undefined : { color: "var(--tile-neutral)" });

/* ── locations ── */

export interface LocationRow {
  id: string;
  name: string;
  kind: LocationKind;
  sortOrder: number;
  active: boolean;
  /** soldiers placed there */
  count: number;
}

function LocationFields({ l, roundId, nextSort }: { l: LocationRow | null; roundId: string; nextSort: number }) {
  return (
    <>
      {l ? <input type="hidden" name="id" value={l.id} /> : null}
      <input type="hidden" name="roundId" value={roundId} />
      <span className="flex flex-wrap items-end gap-2">
        <label className="tz-field">
          <span className="tz-label">שם</span>
          <input className="tz-input min-h-9 w-[160px]" name="name" required maxLength={30} defaultValue={l?.name ?? ""} placeholder="מוצב 131" />
        </label>
        <label className="tz-field">
          <span className="tz-label">סוג</span>
          <select className="tz-input min-h-9 w-[120px]" name="kind" defaultValue={l?.kind ?? "outpost"}>
            {LOCATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {LOCATION_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <Sort value={l?.sortOrder ?? nextSort} />
      </span>
      <Active on={l?.active ?? true} />
    </>
  );
}

/** מיקומים בשבצ״ק: outposts, camps, outside. "מוצב" drives the checks against statuses that need an outpost. */
export function LocationsEditor({ roundId, rows }: { roundId: string; rows: LocationRow[] }) {
  const nextSort = Math.max(0, ...rows.map((r) => r.sortOrder)) + 1;
  return (
    <div className="tz-group">
      {rows.map((l) => (
        <EditRow
          key={l.id}
          action={saveLocation}
          summary={
            <span className="flex min-w-0 flex-1 items-baseline justify-between gap-2">
              <span className="font-semibold" style={inactive(l.active)}>
                {l.name} <span className="tz-footnote font-normal">· {LOCATION_KIND_LABEL[l.kind]}</span>
              </span>
              <span className="tz-footnote tz-num">{l.count} חיילים</span>
            </span>
          }
        >
          <LocationFields l={l} roundId={roundId} nextSort={nextSort} />
        </EditRow>
      ))}
      <AddRow label="הוספת מיקום" action={saveLocation}>
        <LocationFields l={null} roundId={roundId} nextSort={nextSort} />
      </AddRow>
    </div>
  );
}

/* ── standby types ── */

export interface StandbyTypeRow {
  id: string;
  name: string;
  level: StandbyLevel;
  size: number | null;
  requiredRoles: string[];
  sortOrder: number;
  active: boolean;
  /** "פלסר, פלנט" — the companies holding teams of this type */
  heldBy: string;
}

function TypeFields({ t, roundId, nextSort }: { t: StandbyTypeRow | null; roundId: string; nextSort: number }) {
  return (
    <>
      {t ? <input type="hidden" name="id" value={t.id} /> : null}
      <input type="hidden" name="roundId" value={roundId} />
      <span className="flex flex-wrap items-end gap-2">
        <label className="tz-field">
          <span className="tz-label">שם</span>
          <input className="tz-input min-h-9 w-[160px]" name="name" required maxLength={30} defaultValue={t?.name ?? ""} placeholder="עתודת גדוד" />
        </label>
        <label className="tz-field">
          <span className="tz-label">רמה</span>
          <select className="tz-input min-h-9 w-[110px]" name="level" defaultValue={t?.level ?? "company"}>
            {STANDBY_LEVELS.map((k) => (
              <option key={k} value={k}>
                {STANDBY_LEVEL_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="tz-field">
          <span className="tz-label">גודל</span>
          <input className="tz-input min-h-9 w-[72px]" type="number" name="size" min={1} max={50} defaultValue={t?.size ?? ""} />
        </label>
        <Sort value={t?.sortOrder ?? nextSort} />
      </span>
      <label className="tz-field w-full max-w-[420px]">
        <span className="tz-label">תפקידי חובה · שורה לכל תפקיד, ״מ״פ / סמ״פ״ = אחד מהם</span>
        <textarea className="tz-input min-h-[76px] py-2" name="requiredRoles" rows={3} defaultValue={t?.requiredRoles.join("\n") ?? ""} />
      </label>
      <Active on={t?.active ?? true} />
    </>
  );
}

/** סוגי כוננות (mockup 05, "כוננות ורכבים"): size and required roles decide when a team is short. */
export function StandbyTypesEditor({ roundId, rows }: { roundId: string; rows: StandbyTypeRow[] }) {
  const nextSort = Math.max(0, ...rows.map((r) => r.sortOrder)) + 1;
  return (
    <div className="tz-group">
      {rows.map((t) => (
        <EditRow
          key={t.id}
          action={saveStandbyType}
          summary={
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-semibold" style={inactive(t.active)}>
                  {t.name}
                </span>
                <span className={`tz-chip ${t.level === "battalion" ? "tz-chip-brigade" : "tz-chip-signed"}`}>{STANDBY_LEVEL_LABEL[t.level]}</span>
                {t.size ? <span className="tz-footnote tz-num">גודל {t.size}</span> : null}
              </span>
              <span className="tz-footnote truncate">
                {[t.requiredRoles.length ? `חובה: ${t.requiredRoles.join(", ")}` : "אין תפקידי חובה", t.heldBy ? `מוחזק ע״י ${t.heldBy}` : null].filter(Boolean).join(" · ")}
              </span>
            </span>
          }
        >
          <TypeFields t={t} roundId={roundId} nextSort={nextSort} />
        </EditRow>
      ))}
      <AddRow label="סוג כוננות חדש" action={saveStandbyType}>
        <TypeFields t={null} roundId={roundId} nextSort={nextSort} />
      </AddRow>
    </div>
  );
}

/* ── vehicles ── */

export interface VehicleSettingsRow {
  id: string;
  number: string;
  kind: string | null;
  state: VehicleState;
  active: boolean;
  /** "חפ״ק · פלסר" */
  teams: string;
}

function VehicleFields({ v }: { v: VehicleSettingsRow | null }) {
  return (
    <>
      {v ? <input type="hidden" name="id" value={v.id} /> : null}
      <span className="flex flex-wrap items-end gap-2">
        <label className="tz-field">
          <span className="tz-label">צ׳</span>
          <input className="tz-input tz-serial min-h-9 w-[130px] text-left" dir="ltr" inputMode="numeric" name="number" required maxLength={20} defaultValue={v?.number ?? ""} />
        </label>
        <label className="tz-field">
          <span className="tz-label">סוג</span>
          <input className="tz-input min-h-9 w-[130px]" name="kind" maxLength={30} defaultValue={v?.kind ?? ""} placeholder="האמר, דימאקס…" />
        </label>
        <label className="tz-field">
          <span className="tz-label">מצב</span>
          <select className="tz-input min-h-9 w-[110px]" name="state" defaultValue={v?.state ?? "ok"}>
            {VEHICLE_STATES.map((k) => (
              <option key={k} value={k}>
                {VEHICLE_STATE_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
      </span>
      <Active on={v?.active ?? true} />
    </>
  );
}

/** מאגר רכבים: the battalion's vehicles (not per round). Teams pick one by its צ׳ in the team editor. */
export function VehiclesEditor({ rows }: { rows: VehicleSettingsRow[] }) {
  return (
    <div className="tz-group">
      {rows.map((v) => (
        <EditRow
          key={v.id}
          action={saveVehicle}
          summary={
            <span className="flex min-w-0 flex-1 items-center gap-3">
              <span className="w-[90px] flex-none text-[15px] font-semibold" style={inactive(v.active)}>
                <Serial>{v.number}</Serial>
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{v.teams || "לא משובץ לצוות"}</span>
                {v.kind ? <span className="tz-footnote">{v.kind}</span> : null}
              </span>
              <span className={`tz-chip ${v.state === "ok" ? "tz-chip-ok" : "tz-chip-broken"}`}>{VEHICLE_STATE_LABEL[v.state]}</span>
            </span>
          }
        >
          <VehicleFields v={v} />
        </EditRow>
      ))}
      <AddRow label="הוספת רכב" action={saveVehicle}>
        <VehicleFields v={null} />
      </AddRow>
    </div>
  );
}
