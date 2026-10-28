"use client";
import { useMemo, useState, useTransition } from "react";
import { matches, VEHICLE_STATE_LABEL, type VehicleState } from "@gdud/core";
import { Button, Chip, Field, Icon, Serial } from "@gdud/ui";
import type { VehicleCardVM, VehicleOptions } from "@/lib/company/data";
import { mountSerial, setVehicleQty } from "../_actions/vehicles";

/**
 * One of the company's vehicles: the kesher צ׳ mounted on it and its ציוד משלים. The company admin
 * (`options` given) mounts / unmounts צ׳ of the company and sets quantities from the kesher warehouse.
 */
export function VehicleCard({ unitId, vehicle, options }: { unitId: string; vehicle: VehicleCardVM; options: VehicleOptions | null }) {
  const [q, setQ] = useState("");
  const [item, setItem] = useState("");
  const [qty, setQty] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string } | undefined>, after?: () => void) =>
    start(async () => {
      setError(undefined);
      const r = await fn();
      if (r?.error) setError(r.error);
      else after?.();
    });

  const hits = useMemo(() => {
    if (!options || !q.trim()) return [];
    const mounted = new Set(vehicle.serials.map((x) => x.id));
    return options.serials.filter((x) => !mounted.has(x.id) && matches(q, x.serial, x.name)).slice(0, 6);
  }, [options, q, vehicle.serials]);
  const picked = options?.bulk.find((b) => b.id === item);
  const current = vehicle.bulk.find((b) => b.itemId === item)?.qty ?? 0;
  const ok = vehicle.state === "ok";

  return (
    <article className="tz-card flex flex-col" style={vehicle.active ? undefined : { opacity: 0.6 }}>
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--separator)] px-4 py-3">
        <Icon name="truck" size={20} />
        <span className="text-[17px] font-bold">
          <Serial>{vehicle.number}</Serial>
        </span>
        {vehicle.kind ? <span className="tz-footnote">{vehicle.kind}</span> : null}
        <span className="flex-1" />
        <Chip tone={ok ? "ok" : "broken"}>{VEHICLE_STATE_LABEL[vehicle.state as VehicleState] ?? vehicle.state}</Chip>
      </header>
      <div className="px-4 py-2 text-[14px]">
        <span className="tz-footnote">כוננות: </span>
        {vehicle.teamName ?? "לא משובץ לצוות"}
      </div>

      <h3 className="tz-section-header px-4 pt-2">צ׳ קשר על הרכב</h3>
      {vehicle.serials.length ? (
        vehicle.serials.map((x) => (
          <div key={x.id} className="flex items-center gap-2 px-4 py-1.5">
            <span className="min-w-0 flex-1 truncate">
              {x.item} <Serial>{x.serial}</Serial>
            </span>
            {options ? (
              <Button type="button" variant="plain" small disabled={pending} onClick={() => run(() => mountSerial({ unitId, vehicleId: vehicle.id, serialId: x.id, on: false }))}>
                הורדה
              </Button>
            ) : null}
          </div>
        ))
      ) : (
        <p className="tz-footnote m-0 px-4 py-1.5">אין צ׳ על הרכב.</p>
      )}
      {options ? (
        <div className="flex flex-col gap-2 px-4 py-2">
          <label className="tz-search">
            <Icon name="search" size={15} />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="הוספת צ׳ של הפלוגה לרכב — צ׳ או שם" aria-label="חיפוש צ׳ להרכבה" autoComplete="off" />
          </label>
          {hits.length ? (
            <div className="tz-group border border-separator">
              {hits.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  className="tz-row"
                  disabled={pending}
                  onClick={() => run(() => mountSerial({ unitId, vehicleId: vehicle.id, serialId: x.id, on: true }), () => setQ(""))}
                >
                  <span className="tz-row-body min-h-11 py-1.5">
                    <span className="tz-row-title text-[14px]">
                      {x.name} <Serial>{x.serial}</Serial>
                      <span className="tz-row-sub text-xs">{x.vehicle ? `על רכב ${x.vehicle} — יעבור לרכב הזה` : "לא על רכב"}</span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : q.trim() ? (
            <span className="tz-footnote">לא נמצא צ׳ קשר של הפלוגה שמתאים.</span>
          ) : null}
        </div>
      ) : null}

      <h3 className="tz-section-header px-4 pt-3">ציוד משלים</h3>
      {vehicle.bulk.length ? (
        vehicle.bulk.map((b) => (
          <div key={b.itemId} className="flex items-center justify-between gap-2 px-4 py-1.5">
            <span>{b.item}</span>
            <span className="tz-num font-semibold">{b.qty}</span>
          </div>
        ))
      ) : (
        <p className="tz-footnote m-0 px-4 py-1.5">אין ציוד משלים על הרכב.</p>
      )}
      {options ? (
        <div className="grid grid-cols-[1fr_88px_auto] items-end gap-2 px-4 pb-3 pt-2">
          <Field label="פריט">
            <select
              className="tz-input"
              value={item}
              onChange={(e) => {
                setItem(e.target.value);
                setQty(String(vehicle.bulk.find((b) => b.itemId === e.target.value)?.qty ?? ""));
              }}
            >
              <option value="">בחרו…</option>
              {options.bulk.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.available} תקינים במחסן)
                </option>
              ))}
            </select>
          </Field>
          <Field label="כמות ברכב">
            <input type="number" className="tz-input tz-num" min={0} max={current + Math.max(0, picked?.available ?? 0)} value={qty} onChange={(e) => setQty(e.target.value)} disabled={!item} />
          </Field>
          <Button
            type="button"
            variant="tinted"
            small
            loading={pending}
            disabled={!item || qty === "" || Number(qty) === current}
            onClick={() => run(() => setVehicleQty({ unitId, vehicleId: vehicle.id, itemId: item, qty: Number(qty) }), () => setItem(""))}
          >
            שמירה
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 px-4 pb-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </article>
  );
}
