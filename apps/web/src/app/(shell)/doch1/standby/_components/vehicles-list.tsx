"use client";
import { useOptimistic, useState, useTransition } from "react";
import { VEHICLE_STATE_LABEL, VEHICLE_STATES, type VehicleState } from "@gdud/core";
import { Serial } from "@gdud/ui";
import { setVehicleState } from "../../_actions/standby";

export interface VehicleRow {
  id: string;
  number: string;
  kind: string | null;
  state: VehicleState;
  /** "חפ״ק · פלסר, …" */
  teams: string;
  editable: boolean;
}

export const VEHICLE_CHIP: Record<VehicleState, string> = { ok: "tz-chip-ok", service: "tz-chip-broken", broken: "tz-chip-broken" };

/** The vehicles of the user's teams (admin: the whole registry) with their state (mockup 11, "רכבים"). */
export function VehiclesList({ rows }: { rows: VehicleRow[] }) {
  const [list, optimistic] = useOptimistic(rows, (cur, c: { id: string; state: VehicleState }) => cur.map((v) => (v.id === c.id ? { ...v, state: c.state } : v)));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

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
                {v.kind ? <span className="tz-row-sub">{v.kind}</span> : null}
              </span>
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
    </div>
  );
}
