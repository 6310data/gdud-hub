"use client";
import { useState } from "react";
import { MODULES } from "@gdud/core";
import { Field } from "@gdud/ui";

export interface UnitOption {
  id: string;
  label: string;
  depth: number;
}

/** Module → role (depends on module) → scope. */
export function MembershipFields({ userId, units }: { userId: string; units: UnitOption[] }) {
  const [moduleId, setModuleId] = useState<string>(MODULES[0].id);
  const roles = MODULES.find((m) => m.id === moduleId)?.roles ?? [];

  return (
    <>
      <input type="hidden" name="userId" value={userId} />
      <Field label="מחלקה">
        <select name="module" className="tz-input" value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
          {MODULES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="תפקיד">
        <select name="role" className="tz-input" key={moduleId}>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label} — {r.description}
            </option>
          ))}
        </select>
      </Field>
      <Field label="היקף">
        <select name="unitId" className="tz-input" defaultValue="battalion">
          <option value="battalion">כל הגדוד</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {"  ".repeat(u.depth)}
              {u.label}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}
