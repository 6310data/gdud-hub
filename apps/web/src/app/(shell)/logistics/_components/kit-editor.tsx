"use client";
import { useState, useTransition } from "react";
import type { KitLine } from "@gdud/core";
import { Button, Icon } from "@gdud/ui";
import { saveKit } from "../_actions/stock";

/** Controlled list of accessories with − / + steppers, remove, and an "add" row. */
export function KitEditor({ value, onChange, compact }: { value: KitLine[]; onChange: (kit: KitLine[]) => void; compact?: boolean }) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState(1);

  const setAt = (i: number, q: number) => onChange(value.map((k, j) => (j === i ? { ...k, qty: Math.min(99, Math.max(1, q)) } : k)));
  const removeAt = (i: number) => onChange(value.filter((_, j) => j !== i));
  const add = () => {
    const n = name.trim();
    if (!n) return;
    const existing = value.findIndex((k) => k.name === n);
    onChange(existing >= 0 ? value.map((k, j) => (j === existing ? { ...k, qty: Math.min(99, k.qty + qty) } : k)) : [...value, { name: n, qty }]);
    setName("");
    setQty(1);
  };

  return (
    <div className="flex flex-col gap-1">
      {value.map((k, i) => (
        <div key={k.name} className="flex items-center gap-2 text-[14px]">
          <span className="min-w-0 flex-1 truncate">{k.name}</span>
          <span className="tz-stepper" role="group" aria-label={`כמות ${k.name}`}>
            <button type="button" aria-label="הפחתה" onClick={() => setAt(i, k.qty - 1)}>
              <Icon name="minus" size={14} />
            </button>
            <output>{k.qty}</output>
            <button type="button" aria-label="הוספה" onClick={() => setAt(i, k.qty + 1)}>
              <Icon name="plus" size={14} />
            </button>
          </span>
          <button type="button" className="tz-btn tz-btn-plain min-h-0 px-1 text-danger" aria-label={`הסרת ${k.name}`} onClick={() => removeAt(i)}>
            <Icon name="close" size={15} />
          </button>
        </div>
      ))}
      <div className="mt-1 flex gap-1.5">
        <input
          className={`tz-input ${compact ? "min-h-9 text-[14px]" : ""}`}
          placeholder="פריט משלים נוסף"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          maxLength={60}
        />
        <input
          className={`tz-input w-16 text-center ${compact ? "min-h-9 text-[14px]" : ""}`}
          type="number"
          inputMode="numeric"
          min={1}
          max={99}
          value={qty}
          aria-label="כמות"
          onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
        />
        <Button type="button" variant="tinted" small onClick={add} aria-label="הוספת פריט משלים">
          <Icon name="plus" size={16} />
        </Button>
      </div>
    </div>
  );
}

/** Kit standard of an item type, edited in place and saved with saveKit(). */
export function KitStandardForm({ itemId, initial, onDone }: { itemId: string; initial: KitLine[]; onDone?: () => void }) {
  const [kit, setKit] = useState(initial);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <KitEditor value={kit} onChange={setKit} compact />
      {error ? (
        <p role="alert" className="tz-alert tz-alert-error m-0">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          small
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await saveKit({ itemId, kit });
              setError(r?.error);
              if (!r?.error) onDone?.();
            })
          }
        >
          {pending ? "שומר…" : "שמירת תקן"}
        </Button>
        {onDone ? (
          <Button small variant="plain" type="button" onClick={onDone}>
            ביטול
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Inspector block: the standard as text, with an inline editor for stock admins. */
export function KitStandard({ itemId, kit, canEdit }: { itemId: string; kit: KitLine[]; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <KitStandardForm itemId={itemId} initial={kit} onDone={() => setEditing(false)} />;
  return (
    <div className="flex items-center gap-3">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[14px] font-semibold">תקן ציוד משלים</span>
        <span className="tz-footnote">
          {kit.length ? kit.map((k) => (k.qty > 1 ? `${k.qty} ${k.name}` : k.name)).join(", ") : "לא הוגדר לפריט הזה"}
        </span>
      </span>
      {canEdit ? (
        <Button small variant="tinted" type="button" onClick={() => setEditing(true)}>
          {kit.length ? "עריכה" : "הגדרה"}
        </Button>
      ) : null}
    </div>
  );
}
