"use client";
/**
 * Battalion admin: what kesher puts on a vehicle of דוח 1's list — צ׳ (mounted, they stay where they
 * are signed) and ציוד משלים quantities (out of the warehouse). One sheet for a vehicle without gear
 * yet (pick it from the list) and for one that has some; the page's buttons open it through context.
 */
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { matches } from "@gdud/core";
import { Icon, Serial, Spinner } from "@gdud/ui";
import { setVehicle, setVehicleStock } from "../../_actions/vehicles";

export interface VehicleOption {
  id: string;
  number: string;
  /** number · kind · standby */
  label: string;
  /** item id → qty on it */
  stock: Record<string, number>;
}
export interface VehicleSerial {
  id: string;
  serial: string;
  item: string;
  /** במחסן / the company / ללא שיוך */
  place: string;
  /** the vehicle number it is on */
  vehicle: string | null;
}
export interface VehicleItem {
  id: string;
  name: string;
  /** תקינים in the warehouse */
  available: number;
}

const VehicleCtx = createContext<((vehicleId: string | null) => void) | null>(null);
const TOAST_MS = 4000;
const SHOWN = 30;

export function VehicleProvider({ vehicles, serials, items, children }: { vehicles: VehicleOption[]; serials: VehicleSerial[]; items: VehicleItem[]; children: ReactNode }) {
  const router = useRouter();
  /** undefined = closed; null = choose a vehicle */
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
          vehicleId={editing}
          vehicles={vehicles}
          serials={serials}
          items={items}
          onClose={() => setEditing(undefined)}
          onSaved={(msg) => {
            setEditing(undefined);
            setToast(msg);
            router.refresh();
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

/** "שיוך ציוד לרכב" (vehicleId null) or the pencil of a vehicle card. */
export function EditVehicleButton({ vehicleId, label }: { vehicleId: string | null; label?: string }) {
  const open = useContext(VehicleCtx);
  if (!open) return null;
  if (vehicleId === null) {
    return (
      <button type="button" className="tz-btn tz-btn-filled tz-btn-sm" onClick={() => open(null)}>
        <Icon name="plus" size={16} />
        שיוך ציוד לרכב
      </button>
    );
  }
  return (
    <button type="button" className="tz-icon-btn" onClick={() => open(vehicleId)} aria-label={`עריכת הציוד על רכב ${label ?? ""}`}>
      <Icon name="pencil" size={16} />
    </button>
  );
}

function VehicleSheet({
  vehicleId: initial,
  vehicles,
  serials,
  items,
  onClose,
  onSaved,
}: {
  vehicleId: string | null;
  vehicles: VehicleOption[];
  serials: VehicleSerial[];
  items: VehicleItem[];
  onClose(): void;
  onSaved(message: string): void;
}) {
  const [vehicleId, setVehicleId] = useState(initial ?? "");
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const onIt = useMemo(() => serials.filter((x) => vehicle && x.vehicle === vehicle.number), [serials, vehicle]);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(onIt.map((x) => x.id)));
  /** item id → typed qty */
  const [qty, setQty] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const byId = useMemo(() => new Map(serials.map((x) => [x.id, x])), [serials]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function pickVehicle(id: string) {
    const v = vehicles.find((x) => x.id === id);
    setVehicleId(id);
    setChosen(new Set(v ? serials.filter((x) => x.vehicle === v.number).map((x) => x.id) : []));
    setQty({});
  }
  const toggle = (id: string) =>
    setChosen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const had = vehicle?.stock ?? {};
  const lineIds = [...new Set([...Object.keys(had), ...Object.keys(qty)])].filter((id) => itemById.has(id));
  const valueOf = (id: string) => qty[id] ?? String(had[id] ?? 0);
  const hits = q.trim().length >= 2 ? serials.filter((x) => !chosen.has(x.id) && matches(q, x.serial, x.item, x.vehicle)).slice(0, SHOWN) : [];

  function save() {
    setError(undefined);
    if (!vehicle) return setError("בחרו רכב מהרשימה");
    const serialIds = [...chosen].filter((id) => byId.get(id)?.vehicle !== vehicle.number);
    const removeIds = onIt.filter((x) => !chosen.has(x.id)).map((x) => x.id);
    const lines: { itemId: string; qty: number }[] = [];
    for (const id of lineIds) {
      const v = valueOf(id).trim();
      const n = v === "" ? 0 : /^\d+$/.test(v) ? Number(v) : Number.NaN;
      if (Number.isNaN(n)) return setError(`${itemById.get(id)!.name}: "${v}" אינו מספר שלם`);
      if (n !== (had[id] ?? 0)) lines.push({ itemId: id, qty: n });
    }
    if (!serialIds.length && !removeIds.length && !lines.length) return onSaved("לא היה מה לשנות");
    start(async () => {
      let changed = 0;
      if (serialIds.length || removeIds.length) {
        const r = await setVehicle({ vehicleId: vehicle.id, serialIds, removeIds });
        if (!r.ok) return setError(r.error);
        changed += r.data.changed;
      }
      if (lines.length) {
        const r = await setVehicleStock({ vehicleId: vehicle.id, lines });
        if (!r.ok) return setError(r.error);
        changed += r.data.changed;
      }
      onSaved(`עודכנו ${changed} שורות · רכב ${vehicle.number}`);
    });
  }

  return (
    <>
      <button type="button" className="tz-scrim" aria-label="סגירה" onClick={onClose} />
      <div className="tz-sheet" role="dialog" aria-modal="true" aria-label={vehicle ? `ציוד על רכב ${vehicle.number}` : "שיוך ציוד לרכב"}>
        <div className="tz-grabber" />
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-2 pb-1">
          <button type="button" className="tz-btn tz-btn-plain justify-self-start" onClick={onClose}>
            ביטול
          </button>
          <span className="tz-headline">{vehicle ? `רכב ${vehicle.number}` : "שיוך ציוד לרכב"}</span>
          <button type="button" className="tz-btn tz-btn-plain justify-self-end font-semibold" onClick={save} disabled={pending || !vehicle}>
            {pending ? <Spinner size={14} /> : null}
            שמירה
          </button>
        </div>
        <div className="flex flex-col gap-4 px-4 pt-2">
          {error ? (
            <p role="alert" className="tz-alert tz-alert-error m-0 whitespace-pre-line">
              {error}
            </p>
          ) : null}
          <label className="tz-field">
            <span className="tz-label">רכב (מרשימת הרכבים של דוח 1)</span>
            <select className="tz-input" value={vehicleId} onChange={(e) => pickVehicle(e.target.value)} disabled={initial !== null} autoFocus={initial === null}>
              <option value="">בחירת רכב…</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
            {!vehicles.length ? <span className="tz-footnote">אין רכבים ברשימה — מוסיפים אותם בהגדרות דוח 1.</span> : null}
          </label>

          {vehicle ? (
            <>
              <section className="tz-card flex flex-col p-1" aria-label="צ׳ על הרכב">
                <h2 className="tz-panel-title px-3 pb-1 pt-2.5">צ׳ על הרכב · {chosen.size}</h2>
                {[...chosen].map((id) => {
                  const x = byId.get(id);
                  return x ? <SerialLine key={id} x={x} on onToggle={() => toggle(id)} note={x.vehicle && x.vehicle !== vehicle.number ? `יועבר מרכב ${x.vehicle}` : null} /> : null;
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

              <section className="tz-card flex flex-col gap-1 p-1" aria-label="ציוד משלים על הרכב">
                <h2 className="tz-panel-title px-3 pb-1 pt-2.5">ציוד משלים על הרכב</h2>
                {lineIds.map((id) => {
                  const it = itemById.get(id)!;
                  return (
                    <label key={id} className="flex items-center gap-3 rounded-control px-3 py-1.5">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-[14px]">{it.name}</span>
                        <span className="text-xs text-ink-muted">במחסן {Math.max(0, it.available)} תקינים</span>
                      </span>
                      <input
                        className="tz-input tz-num min-h-8 w-[80px] px-2 py-0 text-center"
                        inputMode="numeric"
                        value={valueOf(id)}
                        onChange={(e) => setQty((cur) => ({ ...cur, [id]: e.target.value }))}
                        aria-label={`${it.name} על הרכב`}
                      />
                    </label>
                  );
                })}
                <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
                  <select className="tz-input min-h-8 flex-1 py-0" value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="הוספת פריט">
                    <option value="">הוספת פריט…</option>
                    {items
                      .filter((i) => !lineIds.includes(i.id))
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name} ({Math.max(0, i.available)} במחסן)
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    className="tz-btn tz-btn-tinted tz-btn-sm"
                    disabled={!adding}
                    onClick={() => {
                      setQty((cur) => ({ ...cur, [adding]: "1" }));
                      setAdding("");
                    }}
                  >
                    הוספה
                  </button>
                </div>
              </section>
              <p className="tz-footnote m-0">צ׳ על רכב נשאר חתום במקומו (מחסן או פלוגה). ציוד משלים על רכב יוצא מהמחסן; 0 מחזיר אותו למחסן.</p>
            </>
          ) : null}
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
