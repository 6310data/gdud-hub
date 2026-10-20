"use client";
import { useActionState, useEffect, useRef } from "react";
import { Button } from "@gdud/ui";
import type { ActionResult } from "@/lib/action-result";

type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

/** A form bound to a Server Action, with pending state and an inline error. */
export function ActionForm({
  action,
  submitLabel,
  children,
  variant = "filled",
  className,
}: {
  action: Action;
  submitLabel: string;
  children?: React.ReactNode;
  variant?: "filled" | "tinted" | "plain" | "danger";
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={formAction} className={className ?? "grid gap-3 p-4"}>
      {children}
      <Button variant={variant} disabled={pending} small={variant === "plain" || variant === "danger"}>
        {pending ? "שומר…" : submitLabel}
      </Button>
      {state?.error ? (
        <p role="alert" className="m-0 text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
