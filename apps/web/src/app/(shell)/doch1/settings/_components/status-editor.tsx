"use client";
import { STATUS_FLAG_KEYS, type StatusDef } from "@gdud/core";
import { Icon } from "@gdud/ui";
import { ActionForm } from "@/components/action-form";
import { FLAG_LABEL } from "@/lib/doch1/format";
import { saveStatus } from "../../_actions/settings";

const NEW_STATUS_COLOR = "#7a8699";

export interface CampOption {
  id: string;
  name: string;
}

function StatusFields({ status, roundId, nextSort, camps }: { status: StatusDef | null; roundId: string; nextSort: number; camps: CampOption[] }) {
  return (
    <>
      {status ? <input type="hidden" name="id" value={status.id} /> : null}
      <input type="hidden" name="roundId" value={roundId} />
      <span className="flex flex-wrap items-end gap-2">
        <label className="tz-field">
          <span className="tz-label">צבע</span>
          <input
            type="color"
            name="color"
            defaultValue={status?.color ?? NEW_STATUS_COLOR}
            className="size-9 cursor-pointer rounded-full border-0 bg-transparent p-0"
          />
        </label>
        <label className="tz-field">
          <span className="tz-label">שם</span>
          <input className="tz-input min-h-9 w-[150px]" name="name" required maxLength={30} defaultValue={status?.name ?? ""} />
        </label>
        <label className="tz-field">
          <span className="tz-label">קבוצה בתצוגה</span>
          <input className="tz-input min-h-9 w-[130px]" name="displayGroup" required maxLength={30} defaultValue={status?.displayGroup ?? ""} />
        </label>
        <label className="tz-field">
          <span className="tz-label">הערך בגיליון</span>
          <input className="tz-input min-h-9 w-[110px]" name="sheetValue" required maxLength={30} defaultValue={status?.sheetValue ?? ""} />
        </label>
        <label className="tz-field">
          <span className="tz-label">סדר</span>
          <input className="tz-input min-h-9 w-[72px]" type="number" name="sortOrder" min={0} max={999} defaultValue={status?.sortOrder ?? nextSort} />
        </label>
        {camps.length ? (
          <label className="tz-field">
            <span className="tz-label">מחנה בדוחות</span>
            <select className="tz-input min-h-9 w-[150px]" name="locationId" defaultValue={status?.locationId ?? ""}>
              <option value="">—</option>
              {camps.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </span>
      <span className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[14px]">
        {STATUS_FLAG_KEYS.map((k) => (
          <label key={k} className="flex items-center gap-1.5">
            <input type="checkbox" name={k} defaultChecked={status?.[k] ?? false} />
            {FLAG_LABEL[k]}
          </label>
        ))}
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="standbyAvailable" defaultChecked={status?.standbyAvailable ?? false} />
          זמין לכוננות
        </label>
        <label className="flex items-center gap-2 font-semibold">
          פעיל
          <input type="checkbox" role="switch" name="active" defaultChecked={status?.active ?? true} />
        </label>
      </span>
    </>
  );
}

/** Statuses of the round (mockup 05: "סטטוסים ומיקומים"): one row each, opened to edit name, color, group, sheet value, order and flags. */
export function StatusEditor({ roundId, statuses, camps }: { roundId: string; statuses: StatusDef[]; camps: CampOption[] }) {
  const campName = new Map(camps.map((c) => [c.id, c.name]));
  const nextSort = Math.max(0, ...statuses.map((s) => s.sortOrder)) + 1;
  return (
    <div className="tz-group">
      {statuses.map((s) => {
        const camp = s.locationId ? campName.get(s.locationId) : undefined;
        const flags = [...STATUS_FLAG_KEYS.filter((k) => s[k]).map((k) => FLAG_LABEL[k]), ...(s.standbyAvailable ? ["זמין לכוננות"] : []), ...(camp ? [`ב${camp}`] : [])];
        return (
          <details key={s.id} className="group border-b border-separator">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true" className="size-3.5 flex-none rounded-[4px]" style={{ background: s.color }} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">
                  {s.name} <span className="tz-footnote font-normal">· {s.displayGroup}</span>
                </span>
                <span className="tz-footnote truncate">{flags.length ? flags.join(" · ") : "לא נספר בשום ספירה"}</span>
              </span>
              <span className="tz-footnote" dir="auto" title="הערך בגיליון">
                {s.sheetValue}
              </span>
              <Icon name="chevron" size={17} className="tz-chevron transition-transform group-open:-rotate-90" />
            </summary>
            <ActionForm action={saveStatus} submitLabel="שמירה" variant="tinted" className="flex flex-col items-start gap-3 bg-ground/60 px-4 pb-4 pt-2">
              <StatusFields status={s} roundId={roundId} nextSort={nextSort} camps={camps} />
            </ActionForm>
          </details>
        );
      })}
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 font-semibold text-primary [&::-webkit-details-marker]:hidden">
          <Icon name="plus" size={18} />
          הוספת סטטוס
        </summary>
        <ActionForm action={saveStatus} submitLabel="הוספת סטטוס" variant="filled" className="flex flex-col items-start gap-3 px-4 pb-4 pt-2">
          <StatusFields status={null} roundId={roundId} nextSort={nextSort} camps={camps} />
        </ActionForm>
      </details>
    </div>
  );
}
