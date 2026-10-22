"use client";
import { Field } from "@gdud/ui";
import { ActionForm } from "@/components/action-form";
import { saveRound } from "../../_actions/settings";

export interface RoundFormValues {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  callUpOn: string | null;
  reminderAt: string;
  lockAt: string;
  sendAt: string;
  active: boolean;
}

/** Round dates and the daily times (mockup screen 05: "גדוד וסבב", "דוח 1 היומי"). */
export function RoundForm({ round }: { round: RoundFormValues | null }) {
  return (
    <ActionForm action={saveRound} submitLabel={round ? "שמירת הסבב" : "יצירת סבב"} className="grid gap-3 p-4">
      {round ? <input type="hidden" name="id" value={round.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="שם הסבב">
          <input className="tz-input" name="name" required maxLength={40} defaultValue={round?.name ?? ""} placeholder="סבב 7" />
        </Field>
        <Field label="יום גיוס">
          <input className="tz-input" type="date" name="callUpOn" defaultValue={round?.callUpOn ?? ""} />
        </Field>
        <Field label="תחילת הסבב">
          <input className="tz-input" type="date" name="startsOn" required defaultValue={round?.startsOn ?? ""} />
        </Field>
        <Field label="סיום הסבב">
          <input className="tz-input" type="date" name="endsOn" required defaultValue={round?.endsOn ?? ""} />
        </Field>
      </div>
      <h3 className="tz-panel-title mt-2">דוח 1 היומי</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="תזכורת לפלוגות שלא דיווחו">
          <input className="tz-input" type="time" name="reminderAt" required defaultValue={round?.reminderAt ?? "09:00"} />
        </Field>
        <Field label="נעילת הדוח (אחריה רק מנהל משנה את היום)">
          <input className="tz-input" type="time" name="lockAt" required defaultValue={round?.lockAt ?? "10:00"} />
        </Field>
        <Field label="שליחה לחטיבה">
          <input className="tz-input" type="time" name="sendAt" required defaultValue={round?.sendAt ?? "10:15"} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-[15px]">
        <input type="checkbox" name="active" defaultChecked={round?.active ?? true} />
        סבב פעיל (רק סבב אחד פעיל בכל זמן)
      </label>
    </ActionForm>
  );
}
