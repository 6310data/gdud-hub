"use client";
import { useState } from "react";
import { PROFILE_FIELD_LABEL, type ProfileField } from "@gdud/core";
import { ActionForm } from "@/components/action-form";
import { requestProfileChange, updateMyPhone } from "../_actions/me";

/** "עדכון" opens a one-line form; it closes again after a successful save. */
function Toggle({ label, children }: { label: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="tz-btn tz-btn-plain tz-btn-sm self-start" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  return <>{children(() => setOpen(false))}</>;
}

export function PhoneForm({ current }: { current: string }) {
  return (
    <Toggle label="עדכון טלפון">
      {() => (
        <ActionForm action={updateMyPhone} submitLabel="שמירה" variant="tinted" className="flex items-start gap-2" submitClassName="flex-none">
          <input name="phone" defaultValue={current} className="tz-input tz-serial" inputMode="tel" autoComplete="tel" required maxLength={20} dir="ltr" aria-label="טלפון" />
        </ActionForm>
      )}
    </Toggle>
  );
}

export function ChangeForm({ field, current }: { field: ProfileField; current: string }) {
  return (
    <Toggle label={`בקשה לשינוי ${PROFILE_FIELD_LABEL[field]}`}>
      {() => (
        <ActionForm action={requestProfileChange} submitLabel="שליחה לאישור" variant="tinted" className="flex items-start gap-2" submitClassName="flex-none">
          <input type="hidden" name="field" value={field} />
          <input
            name="value"
            defaultValue={current}
            className="tz-input"
            required={field === "full_name"}
            maxLength={field === "full_name" ? 60 : 40}
            aria-label={PROFILE_FIELD_LABEL[field]}
            placeholder={field === "role_title" ? "ריק = ללא תפקיד" : undefined}
          />
        </ActionForm>
      )}
    </Toggle>
  );
}
