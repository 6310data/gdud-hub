"use client";
/**
 * Battalion admin: what kesher puts on a vehicle of דוח 1's list. One sheet for a vehicle without gear
 * yet (pick it from the list) and for one that has some; the page's buttons open it through context.
 *
 *   a company's vehicle  "ציוד הפלוגה": צ׳ signed to the company and ציוד משלים out of the company's
 *                        free quantity, saved here. "ציוד המחלקה": warehouse צ׳ תקינים and ציוד משלים —
 *                        they go to the company first, so the sheet continues to החתמה (/kesher/sign)
 *                        with the company, the vehicle and the chosen gear filled in.
 *   a battalion vehicle  any צ׳ (it stays where it is signed) and ציוד משלים out of the warehouse.
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
  /** the company it belongs to (null = battalion) and its name */
  unitId: string | null;
  company: string | null;
}
export interface VehicleSerial {
  id: string;
  serial: string;
  item: string;
  /** במחסן / the company / ללא שיוך */
  place: string;
  /** the vehicle number it is on */
  vehicle: string | null;
  /** the company it is signed to */
  unitId: string | null;
  /** in the warehouse and תקין: can be signed out */
  signable: boolean;
}
export interface VehicleItem {
  id: string;
  name: string;
  /** תקינים in the warehouse */
  available: number;
  /** company id → held by the company and not on a vehicle yet */
  free: Record<string, number>;
}

type Source = "company" | "warehouse";

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

/** "3" → 3, "" → 0, anything else → NaN */
const parseQty = (v: string) => (v.trim() === "" ? 0 : /^\d+$/.test(v.trim()) ? Number(v.trim()) : Number.NaN);

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
  const router = useRouter();
  const [vehicleId, setVehicleId] = useState(initial ?? "");
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const unitId = vehicle?.unitId ?? null;
  const [source, setSource] = useState<Source>("company");
  const onIt = useMemo(() => serials.filter((x) => vehicle && x.vehicle === vehicle.number), [serials, vehicle]);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(onIt.map((x) => x.id)));
  /** item id → typed qty on the vehicle */
  const [qty, setQty] = useState<Record<string, string>>({});
  /** ציוד המחלקה to sign to the company and put on the vehicle */
  const [toSign, setToSign] = useState<ReadonlySet<string>>(() => new Set());
  const [signQty, setSignQty] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const byId = useMemo(() => new Map(serials.map((x) => [x.id, x])), [serials]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const fromWarehouse = Boolean(unitId) && source === "warehouse";

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
    setToSign(new Set());
    setSignQty({});
    setSource("company");
  }
  const flip = (set: (f: (cur: ReadonlySet<string>) => ReadonlySet<string>) => void, id: string) =>
    set((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** what this source may offer: a company's vehicle takes the company's צ׳, or warehouse ones to sign */
  const offered = (x: VehicleSerial) => (!unitId ? true : fromWarehouse ? x.signable : x.unitId === unitId);
  const picked = fromWarehouse ? toSign : chosen;
  const hits = q.trim().length >= 2 ? serials.filter((x) => !picked.has(x.id) && offered(x) && matches(q, x.serial, x.item, x.vehicle)).slice(0, SHOWN) : [];

  const had = vehicle?.stock ?? {};
  const lineIds = [...new Set([...Object.keys(had), ...Object.keys(qty)])].filter((id) => itemById.has(id));
  const valueOf = (id: string) => qty[id] ?? String(had[id] ?? 0);
  /** how many more of an item this vehicle can take from where it comes from */
  const room = (it: VehicleItem) => (unitId ? (it.free[unitId] ?? 0) : Math.max(0, it.available));
  const signIds = Object.keys(signQty);

  function save() {
    setError(undefined);
    if (!vehicle) return setError("בחרו רכב מהרשימה");
    if (fromWarehouse) return continueToSign(vehicle);
    const serialIds = [...chosen].filter((id) => byId.get(id)?.vehicle !== vehicle.number);
    const removeIds = onIt.filter((x) => !chosen.has(x.id)).map((x) => x.id);
    const lines: { itemId: string; qty: number }[] = [];
    for (const id of lineIds) {
      const n = parseQty(valueOf(id));
      if (Number.isNaN(n)) return setError(`${itemById.get(id)!.name}: "${valueOf(id)}" אינו מספר שלם`);
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

  /** ציוד המחלקה: on to החתמה to the vehicle's company, with the vehicle and the gear filled in. */
  function continueToSign(v: VehicleOption) {
    const lines: string[] = [];
    for (const id of signIds) {
      const n = parseQty(signQty[id]!);
      if (Number.isNaN(n)) return setError(`${itemById.get(id)!.name}: "${signQty[id]}" אינו מספר שלם`);
      if (n > 0) lines.push(`${id}:${n}`);
    }
    if (!toSign.size && !lines.length) return setError("בחרו צ׳ או ציוד משלים מהמחסן");
    const params = new URLSearchParams({ unit: v.unitId!, vehicle: v.id });
    if (toSign.size) params.set("serials", [...toSign].join(","));
    if (lines.length) params.set("items", lines.join(","));
    router.push(`/kesher/sign?${params}`);
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
            {fromWarehouse ? "המשך להחתמה" : "שמירה"}
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
                  {v.company ? ` · ${v.company}` : ""}
                </option>
              ))}
            </select>
            {!vehicles.length ? <span className="tz-footnote">אין רכבים ברשימה — מוסיפים אותם בהגדרות דוח 1.</span> : null}
          </label>

          {vehicle && unitId ? (
            <div className="flex flex-col gap-1.5">
              <div className="tz-seg w-full" role="tablist" aria-label="מקור הציוד">
                {(
                  [
                    ["company", `ציוד ${vehicle.company ?? "הפלוגה"}`],
                    ["warehouse", "ציוד המחלקה (מחסן)"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    className="tz-seg-item"
                    aria-selected={source === k}
                    onClick={() => {
                      setSource(k);
                      setQ("");
                      setAdding("");
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="tz-footnote">
                {fromWarehouse
                  ? `ציוד מהמחסן נחתם קודם על ${vehicle.company ?? "הפלוגה"}: ממשיכים להחתמה, ואחריה הוא עולה על הרכב.`
                  : `הרכב של ${vehicle.company ?? "הפלוגה"} — עולה עליו רק ציוד שחתום על הפלוגה.`}
              </span>
            </div>
          ) : null}

          {vehicle && !fromWarehouse ? (
            <>
              <section className="tz-card flex flex-col p-1" aria-label="צ׳ על הרכב">
                <h2 className="tz-panel-title px-3 pb-1 pt-2.5">צ׳ על הרכב · {chosen.size}</h2>
                {[...chosen].map((id) => {
                  const x = byId.get(id);
                  return x ? <SerialLine key={id} x={x} on onToggle={() => flip(setChosen, id)} note={x.vehicle && x.vehicle !== vehicle.number ? `יועבר מרכב ${x.vehicle}` : null} /> : null;
                })}
                {!chosen.size ? <p className="tz-footnote m-0 px-3 pb-3">עדיין לא נבחרו צ׳</p> : null}
              </section>

              <SerialSearch q={q} setQ={setQ} hits={hits} placeholder={unitId ? "הוספת צ׳ של הפלוגה — חיפוש לפי צ׳ או סוג מכשיר" : "הוספת צ׳ — חיפוש לפי צ׳ או סוג מכשיר"} onPick={(id) => flip(setChosen, id)} />

              <section className="tz-card flex flex-col gap-1 p-1" aria-label="ציוד משלים על הרכב">
                <h2 className="tz-panel-title px-3 pb-1 pt-2.5">ציוד משלים על הרכב</h2>
                {lineIds.map((id) => {
                  const it = itemById.get(id)!;
                  return (
                    <QtyLine key={id} name={it.name} sub={unitId ? `${room(it)} פנויים בפלוגה` : `במחסן ${room(it)} תקינים`} value={valueOf(id)} onChange={(v) => setQty((cur) => ({ ...cur, [id]: v }))} />
                  );
                })}
                <AddItem
                  items={items.filter((i) => !lineIds.includes(i.id) && (!unitId || room(i) > 0))}
                  label={(i) => (unitId ? `${i.name} (${room(i)} פנויים בפלוגה)` : `${i.name} (${room(i)} במחסן)`)}
                  empty={unitId ? "אין עוד ציוד משלים חתום על הפלוגה" : undefined}
                  adding={adding}
                  setAdding={setAdding}
                  onAdd={(id) => setQty((cur) => ({ ...cur, [id]: "1" }))}
                />
              </section>
              <p className="tz-footnote m-0">
                {unitId
                  ? "ציוד משלים על הרכב הוא חלק ממה שחתום על הפלוגה; 0 מוריד אותו מהרכב והוא נשאר בפלוגה. חסר? עברו ל״ציוד המחלקה״."
                  : "צ׳ על רכב נשאר חתום במקומו (מחסן או פלוגה). ציוד משלים על רכב יוצא מהמחסן; 0 מחזיר אותו למחסן."}
              </p>
            </>
          ) : null}

          {vehicle && fromWarehouse ? (
            <>
              <section className="tz-card flex flex-col p-1" aria-label="צ׳ מהמחסן">
                <h2 className="tz-panel-title px-3 pb-1 pt-2.5">צ׳ מהמחסן להחתמה · {toSign.size}</h2>
                {[...toSign].map((id) => {
                  const x = byId.get(id);
                  return x ? <SerialLine key={id} x={x} on onToggle={() => flip(setToSign, id)} note={null} /> : null;
                })}
                {!toSign.size ? <p className="tz-footnote m-0 px-3 pb-3">עדיין לא נבחרו צ׳</p> : null}
              </section>

              <SerialSearch q={q} setQ={setQ} hits={hits} placeholder="צ׳ תקין מהמחסן — חיפוש לפי צ׳ או סוג מכשיר" onPick={(id) => flip(setToSign, id)} />

              <section className="tz-card flex flex-col gap-1 p-1" aria-label="ציוד משלים מהמחסן">
                <h2 className="tz-panel-title px-3 pb-1 pt-2.5">ציוד משלים מהמחסן להחתמה</h2>
                {signIds.map((id) => {
                  const it = itemById.get(id)!;
                  return <QtyLine key={id} name={it.name} sub={`במחסן ${Math.max(0, it.available)} תקינים`} value={signQty[id]!} onChange={(v) => setSignQty((cur) => ({ ...cur, [id]: v }))} />;
                })}
                <AddItem
                  items={items.filter((i) => !signIds.includes(i.id) && i.available > 0)}
                  label={(i) => `${i.name} (${Math.max(0, i.available)} במחסן)`}
                  adding={adding}
                  setAdding={setAdding}
                  onAdd={(id) => setSignQty((cur) => ({ ...cur, [id]: "1" }))}
                />
              </section>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}

function SerialSearch({ q, setQ, hits, placeholder, onPick }: { q: string; setQ(v: string): void; hits: VehicleSerial[]; placeholder: string; onPick(id: string): void }) {
  return (
    <section className="flex flex-col gap-2" aria-label="הוספת צ׳">
      <label className="tz-search">
        <Icon name="search" size={15} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="חיפוש צ׳" autoComplete="off" />
      </label>
      {hits.length ? (
        <div className="tz-card flex flex-col p-1">
          {hits.map((x) => (
            <SerialLine key={x.id} x={x} on={false} onToggle={() => onPick(x.id)} note={x.vehicle ? `על רכב ${x.vehicle}` : null} />
          ))}
        </div>
      ) : q.trim().length >= 2 ? (
        <p className="tz-footnote m-0 px-1">לא נמצא צ׳</p>
      ) : null}
    </section>
  );
}

function QtyLine({ name, sub, value, onChange }: { name: string; sub: string; value: string; onChange(v: string): void }) {
  return (
    <label className="flex items-center gap-3 rounded-control px-3 py-1.5">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[14px]">{name}</span>
        <span className="text-xs text-ink-muted">{sub}</span>
      </span>
      <input className="tz-input tz-num min-h-8 w-[80px] px-2 py-0 text-center" inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${name} על הרכב`} />
    </label>
  );
}

function AddItem({
  items,
  label,
  empty,
  adding,
  setAdding,
  onAdd,
}: {
  items: VehicleItem[];
  label(i: VehicleItem): string;
  empty?: string;
  adding: string;
  setAdding(id: string): void;
  onAdd(id: string): void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
      <select className="tz-input min-h-8 flex-1 py-0" value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="הוספת פריט" disabled={!items.length}>
        <option value="">{items.length ? "הוספת פריט…" : (empty ?? "אין עוד פריטים")}</option>
        {items.map((i) => (
          <option key={i.id} value={i.id}>
            {label(i)}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="tz-btn tz-btn-tinted tz-btn-sm"
        disabled={!adding}
        onClick={() => {
          onAdd(adding);
          setAdding("");
        }}
      >
        הוספה
      </button>
    </div>
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
