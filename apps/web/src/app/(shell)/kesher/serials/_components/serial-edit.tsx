"use client";
/** "עריכה" on the צ׳ במערכת inspector: opens the same sheet as the company page. */
import { useEffect, useState } from "react";
import { Icon } from "@gdud/ui";
import { SerialSheet, type SheetPerson, type SheetRow, type SheetSuggestions, type SheetVehicle } from "../../_components/serial-sheet";

const TOAST_MS = 4000;

export function SerialEdit({
  row,
  people,
  companies,
  suggestions,
  vehicles,
  isAdmin,
}: {
  row: SheetRow;
  people: SheetPerson[];
  companies: Array<{ id: string; name: string }>;
  suggestions: SheetSuggestions;
  vehicles: SheetVehicle[];
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string>();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <>
      <button type="button" className="tz-btn tz-btn-tinted tz-btn-sm" onClick={() => setOpen(true)}>
        <Icon name="pencil" size={15} />
        עריכה
      </button>
      {open ? (
        <SerialSheet
          rows={[row]}
          people={people}
          companies={companies}
          suggestions={suggestions}
          vehicles={vehicles}
          isAdmin={isAdmin}
          onClose={() => setOpen(false)}
          onSaved={(n) => {
            setOpen(false);
            setToast(n ? "הצ׳ עודכן" : "לא היה מה לשנות");
          }}
        />
      ) : null}
      {toast ? (
        <div className="tz-toast lg:bottom-6" role="status">
          <span>{toast}</span>
        </div>
      ) : null}
    </>
  );
}
