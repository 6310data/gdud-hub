"use client";
import { useState, useTransition } from "react";
import { Button } from "@gdud/ui";
import { updateCompanyItem } from "../_actions/register";

/** A company item's row controls: the quantity (quantity items) and active / inactive. */
export function ItemControls({ id, unitId, quantity, active, serial }: { id: string; unitId: string; quantity: number; active: boolean; serial: string | null }) {
  const [qty, setQty] = useState(String(quantity));
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const run = (input: { quantity?: number; active?: boolean }) =>
    start(async () => {
      const r = await updateCompanyItem({ id, unitId, ...input });
      setError(r?.error);
    });
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      {serial ? null : (
        <>
          <input
            type="number"
            className="tz-input tz-num w-20"
            min={1}
            max={9999}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            aria-label="כמות"
          />
          {Number(qty) !== quantity ? (
            <Button type="button" variant="tinted" small loading={pending} onClick={() => run({ quantity: Number(qty) })}>
              שמירה
            </Button>
          ) : null}
        </>
      )}
      <Button type="button" variant="plain" small loading={pending} onClick={() => run({ active: !active })}>
        {active ? "הוצאה משימוש" : "החזרה לשימוש"}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
