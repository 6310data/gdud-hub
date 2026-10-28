"use client";
import { useState, useTransition } from "react";
import { Button, Chip, Field } from "@gdud/ui";
import { ActionForm } from "@/components/action-form";
import { PersonPicker, PickedPerson, type PickPerson } from "@/components/person-picker";
import { addParticipant, createActivity, removeParticipant, setActivityVehicle, updateActivity } from "../_actions/activities";

export interface ActivityValues {
  id?: string;
  name: string;
  day: string;
  startsAt: string | null;
  endsAt: string | null;
  place: string | null;
  commanderPersonId: string | null;
  notes: string | null;
}

/** New / edit: name, date, times, place, the commander (a soldier of the company) and notes. */
export function ActivityForm({ unitId, soldiers, values }: { unitId: string; soldiers: PickPerson[]; values: ActivityValues }) {
  const [commander, setCommander] = useState<PickPerson | null>(soldiers.find((p) => p.id === values.commanderPersonId) ?? null);
  return (
    <ActionForm action={values.id ? updateActivity : createActivity} submitLabel={values.id ? "שמירה" : "יצירת פעילות"}>
      <input type="hidden" name="unitId" value={unitId} />
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <input type="hidden" name="commanderPersonId" value={commander?.id ?? ""} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="שם">
          <input name="name" className="tz-input" required maxLength={80} defaultValue={values.name} placeholder="סיור, אימון, אבטחת אירוע…" />
        </Field>
        <Field label="תאריך">
          <input name="day" type="date" className="tz-input" required defaultValue={values.day} />
        </Field>
        <Field label="התחלה">
          <input name="startsAt" type="time" className="tz-input" defaultValue={values.startsAt?.slice(0, 5) ?? ""} />
        </Field>
        <Field label="סיום">
          <input name="endsAt" type="time" className="tz-input" defaultValue={values.endsAt?.slice(0, 5) ?? ""} />
        </Field>
        <Field label="מקום">
          <input name="place" className="tz-input" maxLength={80} defaultValue={values.place ?? ""} />
        </Field>
      </div>
      <Field label="מפקד הפעילות">
        {commander ? (
          <PickedPerson person={commander} onClear={() => setCommander(null)} />
        ) : (
          <PersonPicker people={soldiers} onPick={(id) => setCommander(soldiers.find((p) => p.id === id) ?? null)} placeholder="חיפוש חייל בפלוגה לפי שם" />
        )}
      </Field>
      <Field label="הערות">
        <textarea name="notes" className="tz-input" maxLength={1000} defaultValue={values.notes ?? ""} />
      </Field>
    </ActionForm>
  );
}

export interface ParticipantVM {
  participantId: string;
  name: string;
  sub: string;
  role: string | null;
  statusName: string | null;
  qualifies: boolean;
  canRemove: boolean;
}

/**
 * Who goes. The picker offers only the soldiers present and not home that day in דוח 1 (a platoon
 * commander: their platoon's); someone whose status changed since is flagged.
 */
export function Participants({
  unitId,
  activityId,
  people,
  candidates,
  editable,
}: {
  unitId: string;
  activityId: string;
  people: ParticipantVM[];
  candidates: PickPerson[];
  editable: boolean;
}) {
  const [role, setRole] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string } | undefined>) =>
    start(async () => {
      setError(undefined);
      const r = await fn();
      if (r?.error) setError(r.error);
    });

  return (
    <div className="flex flex-col">
      {people.length === 0 ? <div className="p-4 text-ink-muted">עוד לא שובצו חיילים.</div> : null}
      {people.map((p) => (
        <div key={p.participantId} className="flex flex-wrap items-center gap-2 border-b border-[var(--separator)] px-4 py-2.5 last:border-b-0">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-semibold">{p.name}</span>
            <span className="tz-footnote truncate">{[p.role, p.sub, p.statusName].filter(Boolean).join(" · ")}</span>
          </span>
          {p.qualifies ? null : <Chip tone="broken">לא נוכח לפי דוח 1</Chip>}
          {editable && p.canRemove ? (
            <Button type="button" variant="plain" small disabled={pending} onClick={() => run(() => removeParticipant(unitId, p.participantId))}>
              הסרה
            </Button>
          ) : null}
        </div>
      ))}
      {editable ? (
        <div className="flex flex-col gap-2 border-t border-[var(--separator)] p-4">
          <Field label="תפקיד בפעילות (לא חובה)">
            <input className="tz-input" value={role} onChange={(e) => setRole(e.target.value)} maxLength={40} placeholder="נהג, חובש, קשר…" />
          </Field>
          <PersonPicker
            people={candidates}
            placeholder="הוספת חייל — רק מי שנוכח ולא בבית באותו יום"
            empty="אין חייל מתאים: מוצעים רק מי שנוכחים ולא בבית באותו יום לפי דוח 1."
            onPick={(personId) => run(() => addParticipant({ unitId, activityId, personId, role }))}
          />
          {error ? (
            <p role="alert" className="m-0 text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The company's own vehicles going on the activity. */
export function ActivityVehicles({
  unitId,
  activityId,
  vehicles,
  chosen,
  editable,
}: {
  unitId: string;
  activityId: string;
  vehicles: { id: string; label: string }[];
  chosen: string[];
  editable: boolean;
}) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  if (!vehicles.length) return <div className="p-4 text-ink-muted">אין לפלוגה רכבים. רכבים מוסיפים בשבצ״ק וכוננות או דרך מנהל דוח 1.</div>;
  return (
    <div className="flex flex-col">
      {vehicles.map((v) => (
        <label key={v.id} className="tz-row">
          <span className="tz-row-body">
            <span className="tz-row-title tz-serial">{v.label}</span>
            <input
              type="checkbox"
              checked={chosen.includes(v.id)}
              disabled={!editable || pending}
              onChange={(e) =>
                start(async () => {
                  setError(undefined);
                  const r = await setActivityVehicle({ unitId, activityId, vehicleId: v.id, on: e.target.checked });
                  if (r?.error) setError(r.error);
                })
              }
            />
          </span>
        </label>
      ))}
      {error ? (
        <p role="alert" className="m-0 px-4 pb-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
