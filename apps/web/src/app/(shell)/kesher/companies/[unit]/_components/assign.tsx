"use client";
/**
 * Editing צ׳ on the company page: a pencil per row, checkboxes for a group edit, and one sheet for
 * both — the same sheet as צ׳ במערכת (SerialSheet). The table itself stays a server component; these
 * islands share the selection through context. A battalion admin (`isAdmin`) also edits מיקום,
 * חותם על הפלוגה, רכב and הערה.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "@gdud/ui";
import { distinct } from "@/lib/kesher/suggestions";
import { SerialSheet, type SheetPerson, type SheetRow, type SheetVehicle } from "../../../_components/serial-sheet";

interface Ctx {
  selected: ReadonlySet<string>;
  toggle(ids: readonly string[], on: boolean): void;
  open(ids: readonly string[]): void;
}
const AssignCtx = createContext<Ctx | null>(null);
const useAssign = () => useContext(AssignCtx);

const TOAST_MS = 4000;

export function AssignProvider({
  rows,
  people,
  companies,
  vehicles,
  isAdmin,
  children,
}: {
  rows: SheetRow[];
  people: SheetPerson[];
  companies: Array<{ id: string; name: string }>;
  vehicles: SheetVehicle[];
  isAdmin: boolean;
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [sheetFor, setSheetFor] = useState<readonly string[] | null>(null);
  const [toast, setToast] = useState<string>();
  const byId = useMemo(() => new Map(rows.map((r) => [r.serialId, r])), [rows]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const ctx: Ctx = {
    selected,
    toggle: (ids, on) =>
      setSelected((cur) => {
        const next = new Set(cur);
        for (const id of ids) {
          if (on) next.add(id);
          else next.delete(id);
        }
        return next;
      }),
    open: (ids) => setSheetFor(ids),
  };
  const editing = sheetFor?.map((id) => byId.get(id)).filter((r): r is SheetRow => Boolean(r)) ?? [];

  return (
    <AssignCtx.Provider value={ctx}>
      {children}
      {selected.size ? (
        <div className="tz-action-bar lg:sticky lg:bottom-4 lg:rounded-group">
          <span className="text-[15px] font-semibold">{selected.size} נבחרו</span>
          <button type="button" className="tz-btn tz-btn-plain tz-btn-sm" onClick={() => setSelected(new Set())}>
            ניקוי
          </button>
          <button type="button" className="tz-btn tz-btn-filled tz-btn-sm ms-auto" onClick={() => setSheetFor([...selected])}>
            <Icon name="pencil" size={15} />
            עריכת הנבחרים
          </button>
        </div>
      ) : null}
      {editing.length ? (
        <SerialSheet
          key={editing.map((r) => r.serialId).join(",")}
          rows={editing}
          people={people}
          companies={companies}
          suggestions={{ role: distinct(rows.map((r) => r.holderRole)), frame: distinct(rows.map((r) => r.frame)), signerRole: distinct(rows.map((r) => r.signerRole)) }}
          vehicles={vehicles}
          isAdmin={isAdmin}
          onClose={() => setSheetFor(null)}
          onSaved={(n) => {
            setSheetFor(null);
            setSelected(new Set());
            setToast(n ? `עודכנו ${n} צ׳` : "לא היה מה לשנות");
          }}
        />
      ) : null}
      {toast ? (
        <div className="tz-toast lg:bottom-6" role="status">
          <span>{toast}</span>
        </div>
      ) : null}
    </AssignCtx.Provider>
  );
}

/** A row's checkbox (part of a group edit). */
export function RowCheck({ id, label }: { id: string; label: string }) {
  const ctx = useAssign();
  if (!ctx) return null;
  return <input type="checkbox" checked={ctx.selected.has(id)} onChange={(e) => ctx.toggle([id], e.target.checked)} aria-label={`בחירת ${label}`} />;
}

/** "סימון הקבוצה": selects every row of a device type. */
export function GroupCheck({ ids, label }: { ids: readonly string[]; label: string }) {
  const ctx = useAssign();
  if (!ctx) return null;
  const all = ids.length > 0 && ids.every((id) => ctx.selected.has(id));
  return <input type="checkbox" checked={all} onChange={() => ctx.toggle(ids, !all)} aria-label={`בחירת כל ${label}`} />;
}

/** The pencil: edit one row. */
export function RowEdit({ id, label }: { id: string; label: string }) {
  const ctx = useAssign();
  if (!ctx) return null;
  return (
    <button type="button" className="tz-icon-btn" onClick={() => ctx.open([id])} aria-label={`עריכת ${label}`}>
      <Icon name="pencil" size={16} />
    </button>
  );
}
