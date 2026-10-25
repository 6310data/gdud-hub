"use client";
import { startTransition, useActionState, useEffect, useRef } from "react";
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
  submitClassName,
}: {
  action: Action;
  submitLabel: string;
  children?: React.ReactNode;
  variant?: "filled" | "tinted" | "plain" | "danger";
  className?: string;
  submitClassName?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);

  return (
    <form
      ref={ref}
      // submitted through a transition (not action=) so a failed attempt keeps what the user typed;
      // the fields are cleared only on success (effect above)
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
      className={className ?? "grid gap-3 p-4"}
    >
      {children}
      <Button variant={variant} loading={pending} small={variant === "plain" || variant === "danger"} className={submitClassName}>
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
