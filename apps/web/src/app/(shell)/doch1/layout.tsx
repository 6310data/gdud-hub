import Link from "next/link";
import { can } from "@gdud/auth";
import { AppShell, type AppNavItem } from "@/components/app-shell";
import { doch1Access } from "@/lib/doch1/access";
import { doch1Rounds } from "@/lib/doch1/rounds";
import { moduleRoleLabel } from "@/lib/role-label";
import { displayName, requireModule } from "@/lib/session";

const dm = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;

/** דוח 1 as its own app (mockup: references/doch1, screens 01 / 03 / 04 / 06 / 07 / 11). */
export default async function Doch1Layout({ children }: { children: React.ReactNode }) {
  const s = await requireModule("doch1");
  const { active: round, planning } = await doch1Rounds(s);
  const access = doch1Access(s);
  const role = moduleRoleLabel(s, "doch1");

  const main: AppNavItem[] = [
    ...(access.canOverview ? [{ href: "/doch1", label: "סקירה", icon: "grid", exact: true } as const] : []),
    { href: "/doch1/today", label: "דוח 1 של היום", short: "היום", icon: "report" },
    { href: "/doch1/standby", label: "שבצ״ק וכוננות", short: "שבצ״ק", icon: "shield" },
    { href: "/doch1/soldiers", label: "חיילים", icon: "people" },
    { href: "/doch1/call-up", label: "יום גיוס", short: "גיוס", icon: "flag" },
    ...(access.canBoard ? [{ href: "/doch1/board", label: "לוח נוכחות", short: "לוח", icon: "calendar" } as const] : []),
    ...(access.canCopy ? [{ href: "/doch1/copy", label: "העתקה לגיליון", short: "העתקה", icon: "table" } as const] : []),
    ...(access.canReports ? [{ href: "/doch1/reports", label: "דוחות", icon: "doc" } as const] : []),
    ...(access.isAdmin ? [{ href: "/doch1/brigade", label: "דוח לחטיבה", short: "לחטיבה", icon: "send" } as const] : []),
    // while the next round is being prepared: the admin and the companies fill it in
    ...(planning && (access.isAdmin || can(s.user, "doch1", ["company_user"]))
      ? [{ href: "/doch1/planning", label: `תכנון ${planning.name}`, short: "תכנון", icon: "list" } as const]
      : []),
  ];
  const bottom: AppNavItem[] = [
    ...(access.isAdmin ? [{ href: "/doch1/import", label: "ייבוא הגיליון", short: "ייבוא", icon: "upload" } as const] : []),
    ...(access.isMaster ? [{ href: "/doch1/settings", label: "הגדרות", icon: "gear" } as const] : []),
  ];

  return (
    <AppShell
      name="דוח 1"
      sub={round ? `${round.name} · ${dm(round.startsOn)}–${dm(round.endsOn)}` : "אין סבב פעיל"}
      mark={{ text: "ד1" }}
      groups={[{ items: main }]}
      bottom={bottom}
      user={{ name: displayName(s.user, s.claims), email: s.user.email, role: role?.role, roleTone: role?.tone }}
      current="raised"
    >
      {round ? null : (
        <div className="tz-card flex flex-col items-start gap-2 p-5">
          <h2 className="tz-headline">אין סבב פעיל</h2>
          <p className="tz-footnote m-0">
            {planning
              ? `${planning.name} בתכנון.${access.isMaster ? " מפעילים אותו ממסך תכנון הסבב." : ""}`
              : access.isMaster
                ? "כדי להתחיל, צרו סבב והפעילו אותו בהגדרות."
                : "מנהל ראשי צריך להגדיר סבב פעיל."}
          </p>
          {access.isMaster ? (
            <Link href="/doch1/settings" className="tz-btn tz-btn-tinted tz-btn-sm">
              להגדרות
            </Link>
          ) : null}
        </div>
      )}
      {children}
    </AppShell>
  );
}
