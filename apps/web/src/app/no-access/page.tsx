import { redirect } from "next/navigation";
import { Button } from "@gdud/ui";
import { getClaims, getSession } from "@/lib/session";

export const metadata = { title: "אין הרשאה" };

export default async function NoAccessPage() {
  const claims = await getClaims();
  if (!claims) redirect("/login");
  if (await getSession()) redirect("/");

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4 text-center">
      <h1 className="tz-title">אין לך עדיין גישה</h1>
      <p className="tz-body m-0 text-ink-muted">
        החשבון <span className="tz-serial">{claims.email ?? ""}</span> לא הוזמן למערכת, או שהגישה הושבתה.
        בקשו ממנהל המערכת להוסיף אותו ואז היכנסו שוב.
      </p>
      <form action="/auth/signout" method="post">
        <Button variant="tinted" className="w-full">
          כניסה עם חשבון אחר
        </Button>
      </form>
    </main>
  );
}
