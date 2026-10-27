import { sortAsTree, UNIT_KIND_LABEL, type UnitNode } from "@gdud/core";
import { Field } from "@gdud/ui";
import { ActionForm } from "@/components/action-form";
import type { PersonVM } from "@/lib/logistics/data";
import { savePerson } from "../_actions/people";

/** Edit a soldier. `units` = the units the user may place soldiers in. */
export function PersonForm({ person, units }: { person: PersonVM; units: UnitNode[] }) {
  const tree = sortAsTree(units);
  return (
    <ActionForm action={savePerson} submitLabel="שמירה">
      <input type="hidden" name="id" value={person.id} />
      <Field label="שם מלא">
        <input name="fullName" required minLength={2} maxLength={80} className="tz-input" defaultValue={person.name} autoComplete="off" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="מספר אישי">
          <input name="personalNumber" inputMode="numeric" dir="ltr" maxLength={20} className="tz-input tz-serial" defaultValue={person.personalNumber ?? ""} autoComplete="off" />
        </Field>
        <Field label="טלפון">
          <input name="phone" type="tel" dir="ltr" maxLength={20} className="tz-input tz-serial" defaultValue={person.phone ?? ""} autoComplete="off" />
        </Field>
      </div>
      <Field label="פלוגה / מחלקה">
        <select name="unitId" required className="tz-input" defaultValue={person.unitId}>
          <option value="" disabled>
            — בחרו —
          </option>
          {tree.map((u) => (
            <option key={u.id} value={u.id}>
              {"  ".repeat(u.depth)}
              {u.name} ({UNIT_KIND_LABEL[u.kind]})
            </option>
          ))}
        </select>
      </Field>
      <Field label="תפקיד (לא חובה)">
        <input name="roleTitle" maxLength={60} className="tz-input" defaultValue={person.roleTitle ?? ""} />
      </Field>
    </ActionForm>
  );
}

/** Units under which the user may add soldiers (company and below, active). */
export function editableUnits(units: readonly UnitNode[], canEdit: (unitId: string) => boolean): UnitNode[] {
  return units.filter((u) => u.active && u.kind !== "battalion" && canEdit(u.id));
}
