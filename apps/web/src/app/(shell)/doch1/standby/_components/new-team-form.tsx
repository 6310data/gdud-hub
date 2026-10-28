"use client";
import { Field } from "@gdud/ui";
import { ActionForm } from "@/components/action-form";
import { createTeam } from "../../_actions/standby";

type Option = { id: string; name: string };

/**
 * "צוות כוננות חדש": name, company, type and location. Members are added in the team editor. The team is
 * the company's own; the battalion admin (`canShare`) may open a shared (battalion) team instead.
 */
export function NewTeamForm({ companies, types, locations, canShare }: { companies: Option[]; types: Option[]; locations: Option[]; canShare?: boolean }) {
  return (
    <ActionForm action={createTeam} submitLabel="יצירת צוות" className="grid gap-3 p-4 sm:grid-cols-2">
      <Field label="שם הצוות">
        <input className="tz-input" name="name" required maxLength={40} placeholder="חפ״ק, כרמל, עתודה…" />
      </Field>
      <Field label="פלוגה">
        <select className="tz-input" name="holderId" required defaultValue={companies.length === 1 ? companies[0]!.id : ""}>
          {companies.length > 1 ? <option value="">בחירה</option> : null}
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      {canShare ? (
        <Field label="שייכות">
          <select className="tz-input" name="scope" defaultValue="company">
            <option value="company">צוות של הפלוגה</option>
            <option value="battalion">גדודי (משותף, הפלוגה מחזיקה)</option>
          </select>
        </Field>
      ) : null}
      <Field label="סוג כוננות">
        <select className="tz-input" name="typeId" defaultValue="">
          <option value="">ללא (בלי גודל ותפקידי חובה)</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="מיקום">
        <select className="tz-input" name="locationId" defaultValue="">
          <option value="">ללא</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </Field>
    </ActionForm>
  );
}
