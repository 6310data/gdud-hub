"use client";
import { useState, useTransition } from "react";
import { Button } from "@gdud/ui";
import type { ActionResult } from "@/lib/action-result";

/**
 * Runs a bound Server Action. With `confirmLabel`, the first tap arms the button
 * and the second tap runs it (no browser dialogs).
 */
export function ActionButton({
  action,
  label,
  confirmLabel,
  variant = "plain",
}: {
  action: () => Promise<ActionResult>;
  label: string;
  confirmLabel?: string;
  variant?: "filled" | "tinted" | "plain" | "danger";
}) {
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  function onClick() {
    if (confirmLabel && !armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    start(async () => {
      const r = await action();
      setError(r?.error);
    });
  }

  return (
    <span className="inline-flex flex-col items-end">
      <Button type="button" variant={armed ? "danger" : variant} small disabled={pending} onClick={onClick}>
        {pending ? "…" : armed ? confirmLabel : label}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
