"use client";
import { ActionForm } from "@/components/action-form";
import { saveRoundCompany } from "../../_actions/settings";

export interface CompanyRow {
  unitId: string;
  name: string;
  inRound: boolean;
  active: boolean;
  appFrom: string | null;
  members: number;
}

/** Companies in the round, with the pilot switch "דיווח באפליקציה מתאריך". */
export function CompaniesTable({ roundId, rows }: { roundId: string; rows: CompanyRow[] }) {
  return (
    <div className="flex flex-col">
      {rows.map((c) => (
        <ActionForm
          key={c.unitId}
          action={saveRoundCompany}
          submitLabel="שמירה"
          variant="plain"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-separator px-4 py-3 last:border-b-0"
        >
          <input type="hidden" name="roundId" value={roundId} />
          <input type="hidden" name="unitId" value={c.unitId} />
          <span className="flex min-w-[140px] flex-1 flex-col">
            <span className="font-semibold">{c.name}</span>
            <span className="tz-footnote">
              {c.members} ברשימה{c.inRound ? "" : " · עוד לא בסבב"}
            </span>
          </span>
          <label className="flex items-center gap-2 text-[14px]">
            <input type="checkbox" name="active" defaultChecked={c.inRound ? c.active : true} />
            פעילה בסבב
          </label>
          <label className="flex items-center gap-2 text-[14px]">
            דיווח באפליקציה מתאריך
            <input className="tz-input w-[160px]" type="date" name="appFrom" defaultValue={c.appFrom ?? ""} />
          </label>
        </ActionForm>
      ))}
    </div>
  );
}
