"use client";
/**
 * Battalion admin: put צ׳ on a vehicle or take them off. One sheet for a new vehicle and for an
 * existing one (prefilled with what is on it); the page's buttons open it through context.
 */
import { createContext, useContext, useEffect, useId, useMemo, useState, useTransition, type ReactNode } from "react";
import { matches } from "@gdud/core";
import { Icon, Serial, Spinner } from "@gdud/ui";
import { setVehicle } from "../../_actions/vehicles";

export interface VehicleSerial {
  id: string;
  serial: string;
  item: string;
  /** במחסן / the company / ללא שיוך */
  place: string;
  vehicle: string | null;
}

const VehicleCtx = createContext<((vehicle: string | null) => void) | null>(null);
const TOAST_MS = 4000;
const SHOWN = 30;

export function VehicleProvider({ serials, children }: { serials: VehicleSerial[]; children: ReactNode }) {
  /** undefined = closed; null = a new vehicle */
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const [toast, setToast] = useState<string>();
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <VehicleCtx.Provider value={setEditing}>
      {children}
      {editing !== undefined ? (
        <VehicleSheet
          key={editing ?? "new"}
          vehicle={editing}
          serials={serials}
          onClose={() => setEditing(undefined)}
          onSaved={(n, v) => {
            setEditing(undefined);
            setToast(n ? `עודכנו ${n} צ׳${v ? ` · רכב ${v}` : ""}` : "לא היה מה לשנות");
          }}
        />
      ) : null}
      {toast ? (
        <div className="tz-toast lg:bottom-6" role="status">
          <span>{toast}</span>
        </div>
      ) : null}
    </VehicleCtx.Provider>
  );
}

/** "רכב חדש" (vehicle null) or the pencil of a vehicle card. */
export function EditVehicleButton({ vehicle, children }: { vehicle: string | null; children?: ReactNode }) {
  const open = useContext(VehicleCtx);
  if (!open) return null;
  if (vehicle === null) {
    return (
      <button type="button" className="tz-btn tz-btn-filled tz-btn-sm" onClick={() => open(null)}>
        <Icon name="plus" size={16} />
        {children ?? "שיוך צ׳ לרכב"}
      </button>
    );
  }
  return (
    <button type="button" className="tz-icon-btn" onClick={() => open(vehicle)} aria-label={`עריכת הציוד על רכב ${vehicle}`}>
      <Icon name="pencil" size={16} />
    </button>
  );
}

function VehicleSheet({
  vehicle,
  serials,
  onClose,
  onSaved,
}: {
  vehicle: string | null;
  serials: VehicleSerial[];
  onClose(): void;
  onSaved(changed: number, vehicle: string | null): void;
}) {
  const listId = useId();
  const onIt = useMemo(() => serials.filter((x) => vehicle !== null && x.vehicle === vehicle), [serials, vehicle]);
  const [number, setNumber] = useState(vehicle ?? "");
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(onIt.map((x) => x.id)));
  const [q, setQ] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const vehicles = useMemo(() => [...new Set(serials.map((x) => x.vehicle).filter((v): v is string => Boolean(v)))].sort(), [serials]);
  const byId = useMemo(() => new Map(serials.map((x) => [x.id, x])), [serials]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (id: string) =>
    setChosen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const hits = q.trim().length >= 2 ? serials.filter((x) => !chosen.has(x.id) && matches(q, x.serial, x.item, x.vehicle)).slice(0, SHOWN) : [];
  const target = number.trim();

  function save() {
    setError(undefined);
    // renamed vehicle: everything chosen moves to the new number
    const serialIds = [...chosen].filter((id) => byId.get(id)?.vehicle !== target);
    const removeIds = onIt.filter((x) => !chosen.has(x.id)).map((x) => x.id);
    if (!serialIds.length && !removeIds.length) return onSaved(0, target);
    if (serialIds.length && !target) return setError("חסר מספר רכב");
    start(async () => {
      const r = await setVehicle({ vehicle: target, serialIds, removeIds });
      if (!r.ok) return setError(r.error);
      onSaved(r.data.changed, target);
    });
  }

  return (
    <>
      <button type="button" className="tz-scrim" aria-label="סגירה" onClick={onClose} />
      <div className="tz-sheet" role="dialog" aria-modal="true" aria-label={vehicle ? `ציוד על רכב ${vehicle}` : "שיוך צ׳ לרכב"}>
        <div className="tz-grabber" />
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-2 pb-1">
          <button type="button" className="tz-btn tz-btn-plain justify-self-start" onClick={onClose}>
            ביטול
          </button>
          <span className="tz-headline">{vehicle ? `רכב ${vehicle}` : "שיוך צ׳ לרכב"}</span>
          <button type="button" className="tz-btn tz-btn-plain justify-self-end font-semibold" onClick={save} disabled={pending}>
            {pending ? <Spinner size={14} /> : null}
            שמירה
          </button>
        </div>
        <div className="flex flex-col gap-4 px-4 pt-2">
          {error ? (
            <p role="alert" className="tz-alert tz-alert-error m-0">
              {error}
            </p>
          ) : null}
          <label className="tz-field">
            <span className="tz-label">מספר רכב (האמר)</span>
            <input className="tz-input tz-serial" dir="ltr" value={number} maxLength={40} list={listId} onChange={(e) => setNumber(e.target.value)} autoFocus={!vehicle} />
            <datalist id={listId}>
              {vehicles.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </label>

          <section className="tz-card flex flex-col p-1" aria-label="על הרכב">
            <h2 className="tz-panel-title px-3 pb-1 pt-2.5">על הרכב · {chosen.size}</h2>
            {[...chosen].map((id) => {
              const x = byId.get(id);
              return x ? <SerialLine key={id} x={x} on onToggle={() => toggle(id)} note={x.vehicle && x.vehicle !== target ? `יועבר מרכב ${x.vehicle}` : null} /> : null;
            })}
            {!chosen.size ? <p className="tz-footnote m-0 px-3 pb-3">עדיין לא נבחרו צ׳</p> : null}
          </section>

          <section className="flex flex-col gap-2" aria-label="הוספת צ׳">
            <label className="tz-search">
              <Icon name="search" size={15} />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="הוספת צ׳ — חיפוש לפי צ׳ או סוג מכשיר" aria-label="חיפוש צ׳" autoComplete="off" />
            </label>
            {hits.length ? (
              <div className="tz-card flex flex-col p-1">
                {hits.map((x) => (
                  <SerialLine key={x.id} x={x} on={false} onToggle={() => toggle(x.id)} note={x.vehicle ? `על רכב ${x.vehicle}` : null} />
                ))}
              </div>
            ) : q.trim().length >= 2 ? (
              <p className="tz-footnote m-0 px-1">לא נמצא צ׳</p>
            ) : null}
          </section>
          <p className="tz-footnote m-0">השיוך לרכב לא מעביר את הצ׳ בין המחסן לפלוגות.</p>
        </div>
      </div>
    </>
  );
}

function SerialLine({ x, on, onToggle, note }: { x: VehicleSerial; on: boolean; onToggle(): void; note: string | null }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-control px-3 py-2 hover:bg-ground">
      <input type="checkbox" checked={on} onChange={onToggle} aria-label={`${x.item} ${x.serial}`} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[14px]">
          {x.item} · <Serial>{x.serial}</Serial>
        </span>
        <span className="text-xs text-ink-muted">{[x.place, note].filter(Boolean).join(" · ")}</span>
      </span>
    </label>
  );
}
