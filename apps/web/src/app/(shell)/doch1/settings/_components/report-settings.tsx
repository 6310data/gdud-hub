"use client";
import type { ReactNode } from "react";
import { Icon } from "@gdud/ui";
import { ActionForm } from "@/components/action-form";
import { deleteDmhCategory, deleteReportGroup, saveDmhCategory, saveReportGroup, seedDmhCategories } from "../../_actions/settings";

type Action = Parameters<typeof ActionForm>[0]["action"];

/** A settings row opened to edit, with its own delete form under the edit form. */
function EditRow({ summary, action, onDelete, id, roundId, children }: { summary: ReactNode; action: Action; onDelete: Action; id: string; roundId: string; children: ReactNode }) {
  return (
    <details className="group border-b border-separator last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        {summary}
        <Icon name="chevron" size={17} className="tz-chevron transition-transform group-open:-rotate-90" />
      </summary>
      <div className="flex flex-col items-start gap-2 bg-ground/60 px-4 pb-4 pt-2">
        <ActionForm action={action} submitLabel="שמירה" variant="tinted" className="flex flex-col items-start gap-3">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="roundId" value={roundId} />
          {children}
        </ActionForm>
        <ActionForm action={onDelete} submitLabel="מחיקה" variant="danger" className="flex flex-col items-start gap-1">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="roundId" value={roundId} />
        </ActionForm>
      </div>
    </details>
  );
}

function AddRow({ label, action, roundId, children }: { label: string; action: Action; roundId: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 font-semibold text-primary [&::-webkit-details-marker]:hidden">
        <Icon name="plus" size={18} />
        {label}
      </summary>
      <ActionForm action={action} submitLabel={label} variant="filled" className="flex flex-col items-start gap-3 px-4 pb-4 pt-2">
        <input type="hidden" name="roundId" value={roundId} />
        {children}
      </ActionForm>
    </details>
  );
}

function Sort({ value }: { value: number }) {
  return (
    <label className="tz-field">
      <span className="tz-label">סדר</span>
      <input className="tz-input min-h-9 w-[72px]" type="number" name="sortOrder" min={0} max={999} defaultValue={value} />
    </label>
  );
}

const nextSortOf = (rows: ReadonlyArray<{ sortOrder: number }>) => Math.max(0, ...rows.map((r) => r.sortOrder)) + 1;

/* ── דמ״ח categories ── */

export interface DmhCategoryRow {
  id: string;
  name: string;
  listed: boolean;
  sortOrder: number;
  /** soldiers of the round with this category */
  count: number;
}

function CategoryFields({ c, nextSort }: { c: DmhCategoryRow | null; nextSort: number }) {
  return (
    <>
      <span className="flex flex-wrap items-end gap-2">
        <label className="tz-field">
          <span className="tz-label">שם (כמו בעמודת תפקיד לדמ״ח)</span>
          <input className="tz-input min-h-9 w-[200px]" name="name" required maxLength={30} defaultValue={c?.name ?? ""} placeholder="מפקד זוטר" />
        </label>
        <Sort value={c?.sortOrder ?? nextSort} />
      </span>
      <label className="flex items-center gap-1.5 text-[14px]">
        <input type="checkbox" name="listed" defaultChecked={c?.listed ?? false} />
        רשימה שמית בדוחות (כמו מט״בים)
      </label>
    </>
  );
}

/** The R1 columns: one per category, in this order, then יתר for a blank or unknown תפקיד לדמ״ח. */
export function DmhCategoriesEditor({ roundId, rows, unmatched }: { roundId: string; rows: DmhCategoryRow[]; unmatched: number }) {
  const nextSort = nextSortOf(rows);
  return (
    <div className="tz-group">
      {rows.map((c) => (
        <EditRow
          key={c.id}
          id={c.id}
          roundId={roundId}
          action={saveDmhCategory}
          onDelete={deleteDmhCategory}
          summary={
            <span className="flex min-w-0 flex-1 items-baseline justify-between gap-2">
              <span className="font-semibold">
                {c.name}
                {c.listed ? <span className="tz-footnote font-normal"> · רשימה שמית</span> : null}
              </span>
              <span className="tz-footnote tz-num">{c.count} חיילים</span>
            </span>
          }
        >
          <CategoryFields c={c} nextSort={nextSort} />
        </EditRow>
      ))}
      <div className="flex items-baseline justify-between gap-2 border-b border-separator px-4 py-3">
        <span className="font-semibold" style={{ color: "var(--ink-muted)" }}>
          יתר <span className="tz-footnote font-normal">· ריק או לא מוכר</span>
        </span>
        <span className="tz-footnote tz-num">{unmatched} חיילים</span>
      </div>
      <AddRow label="הוספת קטגוריה" action={saveDmhCategory} roundId={roundId}>
        <CategoryFields c={null} nextSort={nextSort} />
      </AddRow>
      <ActionForm action={seedDmhCategories} submitLabel="יצירה מהנתונים" variant="plain" className="flex flex-col items-start gap-1 border-t border-separator px-2 py-2">
        <input type="hidden" name="roundId" value={roundId} />
      </ActionForm>
    </div>
  );
}

/* ── 10א groups ── */

export interface UnitOption {
  id: string;
  name: string;
  platoons: Array<{ id: string; name: string }>;
}

export interface ReportGroupRow {
  id: string;
  name: string;
  commander: string | null;
  unitIds: string[];
  sortOrder: number;
}

function GroupFields({ g, units, nextSort }: { g: ReportGroupRow | null; units: UnitOption[]; nextSort: number }) {
  const on = new Set(g?.unitIds ?? []);
  return (
    <>
      <span className="flex flex-wrap items-end gap-2">
        <label className="tz-field">
          <span className="tz-label">שם השורה</span>
          <input className="tz-input min-h-9 w-[180px]" name="name" required maxLength={40} defaultValue={g?.name ?? ""} placeholder="חפ״קים + תאג״ד" />
        </label>
        <label className="tz-field">
          <span className="tz-label">מפקד</span>
          <input className="tz-input min-h-9 w-[180px]" name="commander" maxLength={60} defaultValue={g?.commander ?? ""} />
        </label>
        <Sort value={g?.sortOrder ?? nextSort} />
      </span>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="tz-label pb-1">יחידות · מסגרת קודמת לפלוגה שלה</legend>
        {units.map((c) => (
          <span key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[14px]">
            <label className="flex items-center gap-1.5 font-semibold">
              <input type="checkbox" name="unitIds" value={c.id} defaultChecked={on.has(c.id)} />
              {c.name}
            </label>
            {c.platoons.map((p) => (
              <label key={p.id} className="flex items-center gap-1.5">
                <input type="checkbox" name="unitIds" value={p.id} defaultChecked={on.has(p.id)} />
                {p.name}
              </label>
            ))}
          </span>
        ))}
      </fieldset>
    </>
  );
}

/** The rows of 10א (the camp report). Without rows the report shows one per company. */
export function ReportGroupsEditor({ roundId, rows, units }: { roundId: string; rows: ReportGroupRow[]; units: UnitOption[] }) {
  const nextSort = nextSortOf(rows);
  const unitName = new Map(units.flatMap((c) => [[c.id, c.name] as const, ...c.platoons.map((p) => [p.id, p.name] as const)]));
  return (
    <div className="tz-group">
      {rows.map((g) => (
        <EditRow
          key={g.id}
          id={g.id}
          roundId={roundId}
          action={saveReportGroup}
          onDelete={deleteReportGroup}
          summary={
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-semibold">
                {g.name}
                {g.commander ? <span className="tz-footnote font-normal"> · {g.commander}</span> : null}
              </span>
              <span className="tz-footnote truncate">
                {g.unitIds
                  .map((id) => unitName.get(id))
                  .filter(Boolean)
                  .join(", ") || "אין יחידות"}
              </span>
            </span>
          }
        >
          <GroupFields g={g} units={units} nextSort={nextSort} />
        </EditRow>
      ))}
      <AddRow label="הוספת שורה" action={saveReportGroup} roundId={roundId}>
        <GroupFields g={null} units={units} nextSort={nextSort} />
      </AddRow>
    </div>
  );
}
