"use client";
import { useState } from "react";
import { Field } from "@gdud/ui";
import { ActionForm } from "@/components/action-form";
import { signInternal } from "../_actions/register";

export interface GearOption {
  value: string;
  label: string;
  /** a quantity item: how many are left */
  available: number | null;
}
export interface SoldierGroup {
  label: string;
  soldiers: { id: string; name: string }[];
}

/** חדש: pick the gear (with where it is now), the receiver and, for a quantity item, how many. */
export function SignForm({ unitId, gear, groups }: { unitId: string; gear: readonly GearOption[]; groups: readonly SoldierGroup[] }) {
  const [picked, setPicked] = useState("");
  const option = gear.find((g) => g.value === picked);
  return (
    <ActionForm action={signInternal} submitLabel="רישום החתמה">
      <input type="hidden" name="unitId" value={unitId} />
      <Field label="ציוד">
        <select name="gear" className="tz-input" required value={picked} onChange={(e) => setPicked(e.target.value)}>
          <option value="">בחרו…</option>
          {gear.map((g) => (
            <option key={g.value} value={g.value} disabled={g.available === 0}>
              {g.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="מי מקבל">
        <select name="to" className="tz-input" required defaultValue="">
          <option value="">בחרו…</option>
          {groups.map((grp) => (
            <optgroup key={grp.label} label={grp.label}>
              {grp.soldiers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      {option?.available != null ? (
        <Field label={`כמות (נשארו ${option.available})`}>
          <input name="quantity" type="number" className="tz-input tz-num" min={1} max={option.available} defaultValue={1} required />
        </Field>
      ) : null}
      <p className="tz-footnote m-0">ההחתמה נרשמת מיד. אם הציוד כבר אצל מישהו בפלוגה, ההחתמה הקודמת שלו נסגרת. לא נרשם דבר במחלקת קשר או בלוגיסטיקה.</p>
    </ActionForm>
  );
}
