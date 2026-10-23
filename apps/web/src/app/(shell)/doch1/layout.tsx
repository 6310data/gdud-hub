import Link from "next/link";
import { withUser } from "@gdud/db";
import { doch1Access } from "@/lib/doch1/access";
import { loadActiveRound } from "@/lib/doch1/data";
import { requireModule } from "@/lib/session";
import { Doch1Nav, type Doch1Section } from "./_components/doch1-nav";

export default async function Doch1Layout({ children }: { children: React.ReactNode }) {
  const s = await requireModule("doch1");
  const round = await withUser(s.claims, (tx) => loadActiveRound(tx));
  const access = doch1Access(s);
  const sections: Doch1Section[] = [
    "today",
    ...(access.canOverview ? (["overview"] as const) : []),
    ...(access.isAdmin ? (["brigade"] as const) : []),
    ...(access.canCopy ? (["copy"] as const) : []),
    ...(access.isAdmin ? (["import", "settings"] as const) : []),
  ];
  return (
    <div data-wide className="flex flex-col gap-[22px]">
      <Doch1Nav sections={sections} roundName={round?.name ?? null} />
      {round ? null : (
        <div className="tz-card flex flex-col items-start gap-2 p-5">
          <h2 className="tz-headline">אין סבב פעיל</h2>
          <p className="tz-footnote m-0">
            {access.isAdmin ? "כדי להתחיל, צרו סבב והפעילו אותו בהגדרות." : "מנהל גדודי צריך להגדיר סבב פעיל."}
          </p>
          {access.isAdmin ? (
            <Link href="/doch1/settings" className="tz-btn tz-btn-tinted tz-btn-sm">
              להגדרות
            </Link>
          ) : null}
        </div>
      )}
      {children}
    </div>
  );
}
