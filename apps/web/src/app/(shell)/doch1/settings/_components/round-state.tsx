"use client";
import { ActionForm } from "@/components/action-form";
import type { RoundState } from "@/lib/doch1/data";
import { ROUND_STATE_CHIP, ROUND_STATE_LABEL } from "@/lib/doch1/format";
import { deletePlanningRound, setRoundState } from "../../_actions/settings";

function StateButton({ id, state, label, variant = "tinted" }: { id: string; state: "active" | "closed"; label: string; variant?: "tinted" | "danger" }) {
  return (
    <ActionForm action={setRoundState} submitLabel={label} variant={variant} className="flex flex-col items-start gap-1.5">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="state" value={state} />
    </ActionForm>
  );
}

/**
 * A round's state and what can change it here. Opening a planning round while another round is
 * active happens on "תכנון סבב" (it closes the active round and applies the pending company moves).
 */
export function RoundStateBar({ id, state, activeName }: { id: string; state: RoundState; activeName: string | null }) {
  return (
    <div className="tz-group flex flex-wrap items-center gap-3 px-4 py-3">
      <span className={`tz-chip ${ROUND_STATE_CHIP[state]}`}>{ROUND_STATE_LABEL[state]}</span>
      {state === "active" ? (
        <details className="flex-1">
          <summary className="cursor-pointer text-[15px] text-danger">סגירת הסבב…</summary>
          <div className="flex flex-col items-start gap-2 pt-2">
            <p className="tz-footnote m-0">אחרי הסגירה אין סבב פעיל: מסך היום, הלוח והתזכורות מפסיקים עד שסבב אחר נפתח. אפשר לפתוח אותו מחדש.</p>
            <StateButton id={id} state="closed" label="סגירת הסבב" variant="danger" />
          </div>
        </details>
      ) : null}
      {state === "closed" ? (
        activeName ? (
          <span className="tz-footnote flex-1">כדי לפתוח אותו מחדש סוגרים קודם את {activeName}.</span>
        ) : (
          <StateButton id={id} state="active" label="פתיחה מחדש" />
        )
      ) : null}
      {state === "planning" ? (
        <>
          {activeName ? (
            <span className="tz-footnote flex-1">הפעלת הסבב סוגרת את {activeName} ונעשית ממסך תכנון סבב.</span>
          ) : (
            <span className="flex flex-1 flex-wrap items-center gap-3">
              <span className="tz-footnote">אין סבב פעיל, אפשר להפעיל אותו מכאן.</span>
              <StateButton id={id} state="active" label="הפעלת הסבב" />
            </span>
          )}
          <details>
            <summary className="cursor-pointer text-[15px] text-danger">מחיקה…</summary>
            <div className="flex flex-col items-start gap-2 pt-2">
              <p className="tz-footnote m-0">נמחקים הסבב, הגדרותיו והחיילים שבו. החיילים עצמם נשארים במערכת.</p>
              <ActionForm action={deletePlanningRound} submitLabel="מחיקת הסבב" variant="danger" className="flex flex-col items-start gap-1.5">
                <input type="hidden" name="id" value={id} />
              </ActionForm>
            </div>
          </details>
        </>
      ) : null}
    </div>
  );
}
