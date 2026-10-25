"use client";
import { ActionForm } from "@/components/action-form";
import { saveRound } from "../../_actions/settings";
import { SettingRow } from "./setting-row";

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

const field = "tz-input w-[180px] min-h-9";

/** Round dates and the daily times (mockup screen 05: "גדוד וסבב", "דוח 1 היומי"). */
export function RoundForm({ round }: { round: RoundFormValues | null }) {
  return (
    <ActionForm
      action={saveRound}
      submitLabel={round ? "שמירת הסבב" : "יצירת סבב"}
      className="flex flex-col gap-1.5"
      submitClassName="self-start mt-2 min-h-11 text-[16px]"
    >
      {round ? <input type="hidden" name="id" value={round.id} /> : null}
      <div className="tz-group">
        <SettingRow label="שם הסבב">
          <input className={field} name="name" required maxLength={40} defaultValue={round?.name ?? ""} placeholder="סבב 7" />
        </SettingRow>
        <SettingRow label="תחילת הסבב">
          <input className={field} type="date" name="startsOn" required defaultValue={round?.startsOn ?? ""} />
        </SettingRow>
        <SettingRow label="סיום הסבב">
          <input className={field} type="date" name="endsOn" required defaultValue={round?.endsOn ?? ""} />
        </SettingRow>
        <SettingRow label="יום גיוס" sub="ממנו הגיליון סופר נוכחות">
          <input className={field} type="date" name="callUpOn" defaultValue={round?.callUpOn ?? ""} />
        </SettingRow>
        <SettingRow label="סבב פעיל" sub="רק סבב אחד פעיל בכל זמן">
          <input type="checkbox" role="switch" name="active" defaultChecked={round?.active ?? true} />
        </SettingRow>
      </div>
      <h3 className="tz-section-header pt-3">דוח 1 היומי</h3>
      <div className="tz-group">
        <SettingRow label="תזכורת לפלוגות שלא דיווחו" sub="התראה למשתמשי הפלוגה">
          <input className="tz-input min-h-9 w-[120px]" type="time" name="reminderAt" required defaultValue={round?.reminderAt ?? "09:00"} />
        </SettingRow>
        <SettingRow label="נעילת הדוח" sub="אחרי הנעילה רק מנהל יכול לשנות את היום">
          <input className="tz-input min-h-9 w-[120px]" type="time" name="lockAt" required defaultValue={round?.lockAt ?? "10:00"} />
        </SettingRow>
        <SettingRow label="שליחה לחטיבה">
          <input className="tz-input min-h-9 w-[120px]" type="time" name="sendAt" required defaultValue={round?.sendAt ?? "10:15"} />
        </SettingRow>
      </div>
    </ActionForm>
  );
}
