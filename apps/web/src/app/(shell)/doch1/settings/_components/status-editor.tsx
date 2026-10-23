"use client";
import { STATUS_FLAG_KEYS, type StatusDef } from "@gdud/core";
import { ActionForm } from "@/components/action-form";
import { FLAG_LABEL } from "@/lib/doch1/format";
import { saveStatus } from "../../_actions/settings";

const NEW_STATUS_COLOR = "#7a8699";

function StatusFields({ status, roundId, nextSort }: { status: StatusDef | null; roundId: string; nextSort: number }) {
  return (
    <>
      {status ? <input type="hidden" name="id" value={status.id} /> : null}
      <input type="hidden" name="roundId" value={roundId} />
      <span className="flex flex-wrap items-center gap-2">
        <input
          type="color"
          name="color"
          aria-label="צבע"
          defaultValue={status?.color ?? NEW_STATUS_COLOR}
          className="size-9 cursor-pointer rounded-full border-0 bg-transparent p-0"
        />
        <input className="tz-input w-[150px]" name="name" required maxLength={30} aria-label="שם" placeholder="שם" defaultValue={status?.name ?? ""} />
        <input
          className="tz-input w-[130px]"
          name="displayGroup"
          required
          maxLength={30}
          aria-label="קבוצה בתצוגה"
          placeholder="קבוצה"
          defaultValue={status?.displayGroup ?? ""}
        />
        <input
          className="tz-input w-[110px]"
          name="sheetValue"
          required
          maxLength={30}
          aria-label="הערך בגיליון"
          placeholder="ערך בגיליון"
          defaultValue={status?.sheetValue ?? ""}
        />
        <input className="tz-input w-[72px]" type="number" name="sortOrder" min={0} max={999} aria-label="סדר" defaultValue={status?.sortOrder ?? nextSort} />
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
        {STATUS_FLAG_KEYS.map((k) => (
          <label key={k} className="flex items-center gap-1.5">
            <input type="checkbox" name={k} defaultChecked={status?.[k] ?? false} />
            {FLAG_LABEL[k]}
          </label>
        ))}
        <label className="flex items-center gap-1.5 font-semibold">
          <input type="checkbox" name="active" defaultChecked={status?.active ?? true} />
          פעיל
        </label>
      </span>
    </>
  );
}

/** Statuses of the round: name, color, group, sheet value, order and the counting flags. */
export function StatusEditor({ roundId, statuses }: { roundId: string; statuses: StatusDef[] }) {
  const nextSort = Math.max(0, ...statuses.map((s) => s.sortOrder)) + 1;
  return (
    <div className="flex flex-col">
      {statuses.map((s) => (
        <ActionForm
          key={s.id}
          action={saveStatus}
          submitLabel="שמירה"
          variant="plain"
          className="flex flex-col items-start gap-2 border-b border-separator px-4 py-3"
        >
          <StatusFields status={s} roundId={roundId} nextSort={nextSort} />
        </ActionForm>
      ))}
      <ActionForm action={saveStatus} submitLabel="הוספת סטטוס" variant="tinted" className="flex flex-col items-start gap-2 px-4 py-3">
        <span className="tz-headline">סטטוס חדש</span>
        <StatusFields status={null} roundId={roundId} nextSort={nextSort} />
      </ActionForm>
    </div>
  );
}
