import { AppShell, type AppNavItem } from "@/components/app-shell";
import { kesherAccess } from "@/lib/kesher/access";
import { moduleRoleLabel } from "@/lib/role-label";
import { displayName, requireModule } from "@/lib/session";

/** מחלקת קשר as its own app (mockup: references/Kesher/mockup/kesher.html). */
export default async function KesherLayout({ children }: { children: React.ReactNode }) {
  const s = await requireModule("kesher");
  const access = kesherAccess(s);
  const role = moduleRoleLabel(s, "kesher");

  const main: AppNavItem[] = [
    { href: "/kesher", label: "סקירה", icon: "home", exact: true },
    { href: "/kesher/companies", label: "פלוגות", icon: "people" },
    { href: "/kesher/serials", label: "צ׳ במערכת", short: "צ׳", icon: "list" },
    { href: "/kesher/stock", label: "ציוד משלים", short: "משלים", icon: "box" },
    { href: "/kesher/vehicles", label: "ציוד על רכבים", short: "רכבים", icon: "truck" },
    { href: "/kesher/log", label: "יומן", icon: "clock" },
  ];
  const actions: AppNavItem[] = [
    ...(access.isAdmin
      ? ([
          { href: "/kesher/sign", label: "החתמה", icon: "pencil" },
          { href: "/kesher/credit", label: "זיכוי", icon: "undo" },
          { href: "/kesher/brigade", label: "מול חטיבה", short: "חטיבה", icon: "swap" },
          { href: "/kesher/broken", label: "ציוד תקול", short: "תקול", icon: "alert" },
          { href: "/kesher/eye", label: "צהוב בעיניים", short: "בעיניים", icon: "flag" },
        ] as const)
      : []),
    ...(access.companies.length ? [{ href: "/kesher/check", label: "דוח צ׳", icon: "check" } as const] : []),
    { href: "/kesher/reports", label: "הפקת דוחות", short: "דוחות", icon: "report" },
    ...(access.isAdmin ? [{ href: "/kesher/import", label: "ייבוא מהגיליון", short: "ייבוא", icon: "upload" } as const] : []),
  ];

  return (
    <AppShell
      name="מחלקת קשר"
      sub="פיזור צ׳, החתמות ומלאי"
      mark={{ icon: "antenna" }}
      search={{ action: "/kesher/serials", placeholder: "חיפוש צ׳, מכשיר או חותם" }}
      groups={[{ items: main }, { title: "פעולות", items: actions }]}
      bottom={access.isAdmin ? [{ href: "/kesher/settings", label: "הגדרות", icon: "gear" }] : undefined}
      user={{ name: displayName(s.user, s.claims), email: s.user.email, role: role?.role, roleTone: role?.tone }}
      current="tinted"
      phoneTabs={["/kesher", "/kesher/companies", "/kesher/serials", "/kesher/stock"]}
    >
      {children}
    </AppShell>
  );
}
