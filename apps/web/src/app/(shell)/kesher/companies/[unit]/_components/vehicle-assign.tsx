"use client";
/**
 * שיוך לרכב, in a company's ציוד משלים table: put some of the item the company signed for on one of
 * its vehicles (or change / clear what is on it). The quantity on a vehicle comes out of the company's
 * free quantity — the warehouse doesn't change.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Field } from "@gdud/ui";
import { setCompanyVehicleStock } from "../../../_actions/vehicles";

export interface AssignVehicle {
  id: string;
  label: string;
  /** of this item on it now */
  qty: number;
}

export function VehicleAssign({ itemId, itemName, free, vehicles }: { itemId: string; itemName: string; free: number; vehicles: AssignVehicle[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [qty, setQty] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const current = vehicles.find((v) => v.id === vehicleId)?.qty ?? 0;

  if (!vehicles.length) return null;
  if (!open)
    return (
      <Button type="button" variant="plain" small onClick={() => setOpen(true)} disabled={!free && vehicles.every((v) => !v.qty)}>
        שיוך לרכב
      </Button>
    );

  const save = () =>
    start(async () => {
      setError(undefined);
      const r = await setCompanyVehicleStock({ vehicleId, itemId, qty: Number(qty) });
      if ("error" in r) {
        setError(r.error);
        return;
      }
      setOpen(false);
      setVehicleId("");
      router.refresh();
    });

  return (
    <div className="flex min-w-[240px] flex-col gap-2" aria-label={`שיוך ${itemName} לרכב`}>
      <div className="grid grid-cols-[1fr_80px] items-end gap-2">
        <Field label="רכב">
          <select
            className="tz-input"
            value={vehicleId}
            onChange={(e) => {
              setVehicleId(e.target.value);
              setQty(String(vehicles.find((v) => v.id === e.target.value)?.qty ?? ""));
            }}
          >
            <option value="">בחרו…</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
                {v.qty ? ` (${v.qty} עליו)` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="כמות ברכב">
          <input type="number" className="tz-input tz-num" min={0} max={current + free} value={qty} onChange={(e) => setQty(e.target.value)} disabled={!vehicleId} />
        </Field>
      </div>
      <span className="tz-footnote">{free} פנויים בפלוגה · 0 מוריד מהרכב</span>
      <div className="flex gap-2">
        <Button type="button" variant="tinted" small loading={pending} disabled={!vehicleId || qty === "" || Number(qty) === current} onClick={save}>
          שמירה
        </Button>
        <Button type="button" variant="plain" small disabled={pending} onClick={() => setOpen(false)}>
          ביטול
        </Button>
      </div>
      {error ? (
        <p role="alert" className="m-0 whitespace-pre-line text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
