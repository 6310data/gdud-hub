export type ActionResult = { ok?: true; error?: string } | undefined;

/** Turn a database error into a short Hebrew message (never leak SQL to the browser). */
export function dbErrorMessage(err: unknown): string {
  const code = pgCode(err);
  if (code === "23505") return "הרשומה כבר קיימת.";
  if (code === "42501") return "אין לך הרשאה לפעולה הזו.";
  if (code === "23503") return "הפריט מקושר לנתונים אחרים ולא ניתן לשנות אותו.";
  if (code === "23514") return "אחד השדות לא בפורמט הנכון.";
  console.error(err);
  return "הפעולה נכשלה. נסו שוב.";
}

function pgCode(err: unknown): string | undefined {
  let e: unknown = err;
  for (let i = 0; i < 4 && e && typeof e === "object"; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Result of an action that returns data (e.g. the id of a created form). */
export type ActionOutcome<T> = { ok: true; data: T; error?: undefined } | { ok?: undefined; error: string };

/** A validation failure whose message is safe to show the user as is. */
export class UserError extends Error {}

/** UserError → its message; anything else → a generic Hebrew message (details logged). */
export function actionError(err: unknown): string {
  return err instanceof UserError ? err.message : dbErrorMessage(err);
}
