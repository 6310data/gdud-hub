import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Field } from "@gdud/ui";
import { ActionForm } from "@/components/action-form";
import { getClaims, getSession } from "@/lib/session";
import { requestJoin } from "./actions";

export const metadata = { title: "הצטרפות" };

/**
 * הצטרפות (replaces "אין לך עדיין גישה"): a Google account that isn't linked to a soldier types the
 * personal number and the last 4 digits of the phone; a commander of the company approves. The
 * screen after sending is the same whether or not the details matched a soldier.
 */
export default async function JoinPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const claims = await getClaims();
  if (!claims) redirect("/login");
  const session = await getSession();
  if (session?.personId) redirect("/");
  const { sent } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-5 px-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <div
          className="grid size-[72px] place-items-center text-[30px] font-bold text-white"
          style={{ background: "var(--primary)", borderRadius: "var(--radius-app-icon)", boxShadow: "var(--app-icon)" }}
          aria-hidden="true"
        >
          ג
        </div>
        <h1 className="tz-title">{sent ? "הבקשה נשלחה למפקד" : "הצטרפות למערכת הגדוד"}</h1>
        <p className="tz-body m-0 text-ink-muted">
          {sent
            ? "כשהמפקד יאשר שזה אתה, תוכל להיכנס עם החשבון הזה ולראות את הציוד, דוח 1 והפרטים שלך. אם לא אושרת תוך יום–יומיים, פנו למפקד ובדקו איתו את המספר האישי."
            : "כתבו את המספר האישי ואת 4 הספרות האחרונות של הטלפון כפי שהם רשומים בפלוגה. מפקד הפלוגה יאשר את הבקשה."}
        </p>
        <p className="tz-footnote m-0">
          חשבון: <span className="tz-serial">{claims.email ?? ""}</span>
        </p>
      </div>

      {sent ? null : (
        <div className="tz-card">
          <ActionForm action={requestJoin} submitLabel="שליחת בקשה">
            <Field label="מספר אישי">
              <input name="personalNumber" className="tz-input tz-serial" inputMode="numeric" autoComplete="off" required maxLength={16} dir="ltr" />
            </Field>
            <Field label="4 הספרות האחרונות של הטלפון">
              <input name="phoneLast4" className="tz-input tz-serial" inputMode="numeric" autoComplete="off" required maxLength={4} pattern="[0-9]{4}" dir="ltr" />
            </Field>
          </ActionForm>
        </div>
      )}

      <p className="tz-footnote m-0 text-center">
        {session ? "החשבון כבר רשום במערכת, אבל לא מקושר לחייל. אם הוזמנת על ידי מנהל המערכת אין צורך בבקשה." : "אם החשבון שלך הושבת, פנו למנהל המערכת."}
      </p>
      <form action="/auth/signout" method="post">
        <Button variant="tinted" className="w-full">
          כניסה עם חשבון אחר
        </Button>
      </form>
      {session ? (
        <Link href="/" className="tz-btn tz-btn-plain">
          חזרה למערכת
        </Link>
      ) : null}
    </main>
  );
}
