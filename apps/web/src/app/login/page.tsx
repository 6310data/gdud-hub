import { redirect } from "next/navigation";
import { safeNextPath } from "@gdud/auth";
import { getClaims } from "@/lib/session";
import { GoogleSignIn } from "./google-sign-in";

export const metadata = { title: "כניסה" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const nextPath = safeNextPath(next);
  if (await getClaims()) redirect(nextPath);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <div className="mb-8 flex flex-col items-center gap-4 text-center">
        <div
          className="grid size-[84px] place-items-center text-[34px] font-bold text-white"
          style={{ background: "var(--primary)", borderRadius: "var(--radius-app-icon)", boxShadow: "var(--app-icon)" }}
          aria-hidden="true"
        >
          ג
        </div>
        <h1 className="tz-title">מערכת הגדוד</h1>
        <p className="tz-footnote m-0">כניסה עם חשבון Google שהוזמן על ידי מנהל המערכת</p>
      </div>

      {error ? (
        <p role="alert" className="mb-4 rounded-group bg-[var(--danger-soft)] p-3 text-center text-sm text-danger">
          הכניסה נכשלה. נסו שוב.
        </p>
      ) : null}

      <GoogleSignIn next={nextPath} />
    </main>
  );
}
