"use client";
import { useEffect, useOptimistic, useState, useTransition } from "react";
import { VEHICLE_STATE_LABEL, VEHICLE_STATES, type VehicleState } from "@gdud/core";
import { Serial, Spinner } from "@gdud/ui";
import { setVehicleCompany, setVehicleState } from "../../_actions/standby";

export interface VehicleRow {
  id: string;
  number: string;
  kind: string | null;
  state: VehicleState;
  /** "חפ״ק · פלסר, …" */
  teams: string;
  /** the company it belongs to; null = battalion */
  company: string | null;
  unitId: string | null;
  editable: boolean;
  /** the kesher gear on it (battalion admin only): it goes with the vehicle to its new company */
  gear: { serials: number; bulk: number } | null;
}

interface Move {
  vehicle: VehicleRow;
  unitId: string | null;
  to: string;
}

export const VEHICLE_CHIP: Record<VehicleState, string> = { ok: "tz-chip-ok", service: "tz-chip-broken", broken: "tz-chip-broken" };

/**
 * The vehicles of the user's teams and companies (admin: the whole registry) with their state (mockup 11,
 * "רכבים"). With `companies` (the battalion admin) each vehicle's company can be set here; a vehicle
 * carrying kesher gear asks first, since the gear moves to the new company with it.
 */
export function VehiclesList({ rows, companies }: { rows: VehicleRow[]; companies?: { id: string; name: string }[] }) {
  const [list, optimistic] = useOptimistic(rows, (cur, c: { id: string; state: VehicleState }) => cur.map((v) => (v.id === c.id ? { ...v, state: c.state } : v)));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [confirm, setConfirm] = useState<Move>();

  const assign = (id: string, unitId: string | null) => {
    setError(undefined);
    start(async () => {
      const r = await setVehicleCompany({ vehicleId: id, unitId });
      if (r?.error) setError(r.error);
      setConfirm(undefined);
    });
  };
  const pick = (v: VehicleRow, unitId: string | null) => {
    if (!v.gear) return assign(v.id, unitId);
    setConfirm({ vehicle: v, unitId, to: unitId ? (companies?.find((c) => c.id === unitId)?.name ?? "הפלוגה") : "הגדוד" });
  };

  const set = (id: string, state: VehicleState) => {
    setError(undefined);
    start(async () => {
      optimistic({ id, state });
      const r = await setVehicleState({ vehicleId: id, state });
      if (r?.error) setError(r.error);
    });
  };

  if (!list.length) return <p className="tz-card m-0 p-5 text-ink-muted">עוד אין רכבים משובצים לצוותים.</p>;
  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p role="alert" className="tz-alert tz-alert-error m-0">
          {error}
        </p>
      ) : null}
      <div className="tz-group">
        {list.map((v) => (
          <div key={v.id} className="tz-row">
            <span className="tz-row-body flex-wrap gap-y-2 py-2">
              <span className="w-[90px] flex-none text-[15px] font-semibold">
                <Serial>{v.number}</Serial>
              </span>
              <span className="tz-row-title min-w-[140px]">
                {v.teams || "לא משובץ לצוות"}
                <span className="tz-row-sub">{[v.kind, companies ? null : v.company].filter(Boolean).join(" · ")}</span>
              </span>
              {companies ? (
                <select
                  className="tz-input w-[130px] flex-none"
                  aria-label={`השייכות של רכב ${v.number}`}
                  value={v.unitId ?? ""}
                  disabled={pending}
                  onChange={(e) => pick(v, e.target.value || null)}
                >
                  <option value="">גדודי</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : null}
              {v.editable ? (
                <span className="tz-seg w-[210px] flex-none" role="tablist" aria-label={`מצב הרכב ${v.number}`}>
                  {VEHICLE_STATES.map((st) => (
                    <button
                      key={st}
                      type="button"
                      role="tab"
                      className="tz-seg-item"
                      aria-selected={v.state === st}
                      disabled={pending}
                      onClick={() => v.state !== st && set(v.id, st)}
                    >
                      {VEHICLE_STATE_LABEL[st]}
                    </button>
                  ))}
                </span>
              ) : (
                <span className={`tz-chip ${VEHICLE_CHIP[v.state]}`}>{VEHICLE_STATE_LABEL[v.state]}</span>
              )}
            </span>
          </div>
        ))}
      </div>
      {confirm ? <MoveSheet move={confirm} pending={pending} onConfirm={() => assign(confirm.vehicle.id, confirm.unitId)} onClose={() => setConfirm(undefined)} /> : null}
    </div>
  );
}

/** "להעביר את הרכב עם ציוד הקשר?" — the gear on it is signed over to the new company (or the warehouse). */
function MoveSheet({ move, pending, onConfirm, onClose }: { move: Move; pending: boolean; onConfirm(): void; onClose(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const { vehicle, to } = move;
  const gear = [vehicle.gear?.serials ? `${vehicle.gear.serials} צ׳ קשר` : null, vehicle.gear?.bulk ? `${vehicle.gear.bulk} יח׳ ציוד משלים` : null].filter(Boolean).join(" ו־");
  const from = vehicle.company ?? "הגדוד";

  return (
    <>
      <button type="button" className="tz-scrim" aria-label="סגירה" onClick={onClose} />
      <div className="tz-sheet flex flex-col" role="dialog" aria-modal="true" aria-label="העברת רכב עם ציוד הקשר">
        <div className="tz-grabber" />
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-2 pb-1">
          <button type="button" className="tz-btn tz-btn-plain justify-self-start" onClick={onClose}>
            ביטול
          </button>
          <span className="tz-headline">
            העברת רכב <Serial>{vehicle.number}</Serial>
          </span>
          <span />
        </div>
        <p className="tz-footnote m-0 pb-3.5 text-center">
          {from} ← {to}
        </p>
        <div className="flex flex-col gap-2.5 px-4">
          <p className="m-0 text-[15px]">
            על הרכב {gear}. הציוד יעבור יחד עם הרכב ל{to}: {move.unitId ? `הוא ייחתם על ${to}` : "הוא יחזור למחסן הקשר"}
            {vehicle.unitId ? ` ויזוכה מ${from}` : ""}, וזה יירשם ביומן של מחלקת הקשר.
          </p>
          <button type="button" className="tz-btn tz-btn-filled min-h-11 text-base" disabled={pending} aria-busy={pending || undefined} autoFocus onClick={onConfirm}>
            {pending ? <Spinner /> : null}
            העברה עם הציוד
          </button>
        </div>
      </div>
    </>
  );
}
