"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@gdud/ui";
import { activatePlanningRound } from "../../_actions/planning";

/**
 * "הפעלת הסבב" with what it will do, on two taps (no browser dialog): the first shows the list
 * and arms the button, the second runs it. One transaction on the server.
 */
export function ActivateRound({ lines, warning }: { lines: string[]; warning: string | null }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-col items-start gap-2">
      {armed ? (
        <ul className="m-0 flex list-disc flex-col gap-0.5 ps-5 text-[15px]">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : null}
      {armed && warning ? <p className="tz-alert m-0">{warning}</p> : null}
      <span className="flex flex-wrap gap-2">
        <Button
          type="button"
          small
          variant={armed ? "danger" : "filled"}
          loading={pending}
          onClick={() => {
            if (!armed) return setArmed(true);
            setError(undefined);
            start(async () => {
              const r = await activatePlanningRound();
              if (r?.error) setError(r.error);
              else router.push("/doch1/today");
            });
          }}
        >
          {armed ? "כן, להפעיל" : "הפעלת הסבב…"}
        </Button>
        {armed && !pending ? (
          <Button type="button" small variant="plain" onClick={() => setArmed(false)}>
            ביטול
          </Button>
        ) : null}
      </span>
      {error ? (
        <p role="alert" className="tz-alert tz-alert-error m-0">
          {error}
        </p>
      ) : null}
    </div>
  );
}
