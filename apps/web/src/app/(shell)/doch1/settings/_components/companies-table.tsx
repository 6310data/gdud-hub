"use client";
import { ActionForm } from "@/components/action-form";
import { saveRoundCompany } from "../../_actions/settings";

export interface CompanyRow {
  unitId: string;
  name: string;
  color: string | null;
  inRound: boolean;
  active: boolean;
  appFrom: string | null;
  members: number;
}

/** Companies in the round, with the pilot switch "דיווח באפליקציה מתאריך" (mockup 05: "פלוגות ומסגרות"). */
export function CompaniesTable({ roundId, rows }: { roundId: string; rows: CompanyRow[] }) {
  return (
    <div className="tz-group">
      {rows.map((c) => {
        const on = c.inRound && c.active;
        return (
          <ActionForm
            key={c.unitId}
            action={saveRoundCompany}
            submitLabel="שמירה"
            variant="plain"
            className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-separator px-4 py-3 last:border-b-0"
          >
            <input type="hidden" name="roundId" value={roundId} />
            <input type="hidden" name="unitId" value={c.unitId} />
            <span aria-hidden="true" className="size-7 flex-none rounded-full" style={{ background: on ? (c.color ?? "var(--tile-neutral)") : "var(--chevron)" }} />
            <span className="flex min-w-[110px] flex-1 flex-col">
              <span className="font-semibold" style={on ? undefined : { color: "var(--tile-neutral)" }}>
                {c.name}
              </span>
              <span className="tz-footnote">
                <span className="tz-num">{c.members}</span> ברשימה{c.appFrom ? " · מדווחת באפליקציה" : ""}
              </span>
            </span>
            <span className={`tz-chip ${on ? "tz-chip-ok" : "tz-chip-signed"}`}>{!c.inRound ? "עוד לא בסבב" : c.active ? "פעילה" : "לא פעילה בסבב"}</span>
            <label className="flex items-center gap-2 text-[14px]">
              פעילה בסבב
              <input type="checkbox" role="switch" name="active" defaultChecked={c.inRound ? c.active : true} />
            </label>
            <label className="flex items-center gap-2 text-[14px]">
              באפליקציה מתאריך
              <input className="tz-input min-h-9 w-[150px]" type="date" name="appFrom" defaultValue={c.appFrom ?? ""} />
            </label>
          </ActionForm>
        );
      })}
    </div>
  );
}
