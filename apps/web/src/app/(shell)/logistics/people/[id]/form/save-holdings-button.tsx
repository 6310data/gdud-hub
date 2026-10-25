"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Icon } from "@gdud/ui";
import { issueHoldingsForm } from "../../../_actions/people";

export function SaveHoldingsButton({ personId, signer }: { personId: string; signer: string }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        small
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await issueHoldingsForm({ personId, signer });
            if (r.ok) router.push(`/logistics/forms/${r.data.formId}?done=1`);
            else setError(r.error);
          })
        }
      >
        {pending ? null : <Icon name="doc" size={16} />}
        {pending ? "שומר…" : "שמירת הטופס"}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
