import { AppShell, type AppNavItem } from "@/components/app-shell";
import { logisticsAccess } from "@/lib/logistics/access";
import { moduleRoleLabel } from "@/lib/role-label";
import { displayName, requireModule } from "@/lib/session";

/** לוגיסטיקה גדודית as its own app (mockup: references/logistics/לוגיסטיקה גדודית – Redesign.html). */
export default async function LogisticsLayout({ children }: { children: React.ReactNode }) {
  const s = await requireModule("logistics");
  const access = logisticsAccess(s);
  const role = moduleRoleLabel(s, "logistics");

  const main: AppNavItem[] = [
    { href: "/logistics", label: "סקירה", icon: "home", exact: true },
    { href: "/logistics/people", label: "פלוגות ואלפון", short: "פלוגות", icon: "people", also: ["/logistics/forms"] },
    { href: "/logistics/stock", label: "מחסן", icon: "box", also: ["/logistics/serials"] },
    { href: "/logistics/summary", label: "סיכום אמצעים", short: "סיכום", icon: "table" },
    { href: "/logistics/storage", label: "אפסון", icon: "archive" },
    { href: "/logistics/log", label: "לוג פעולות", short: "לוג", icon: "clock" },
  ];
  const actions: AppNavItem[] = access.isAdmin
    ? [
        { href: "/logistics/sign", label: "החתמה חדשה", short: "החתמה", icon: "pencil" },
        { href: "/logistics/return", label: "זיכוי", icon: "undo" },
        ...(access.isStockAdmin ? [{ href: "/logistics/import", label: "ייבוא מהגיליון", short: "ייבוא", icon: "upload" } as const] : []),
      ]
    : [];
  const bottom: AppNavItem[] = access.isMaster ? [{ href: "/logistics/settings", label: "הגדרות", icon: "gear" }] : [];

  return (
    <AppShell
      name="לוגיסטיקה גדודית"
      sub="החתמות, זיכויים ומלאי צ׳"
      mark={{ icon: "logo" }}
      search={{ action: "/logistics/search", placeholder: "חיפוש חייל, צ׳ או פריט" }}
      groups={[{ items: main }, ...(actions.length ? [{ title: "פעולות", items: actions }] : [])]}
      bottom={bottom}
      user={{ name: displayName(s.user, s.claims), email: s.user.email, role: role?.role, roleTone: role?.tone }}
      // phone tab bar: four tabs, the rest (פלוגות, לוג, החתמה, זיכוי, ייבוא, הגדרות) under "עוד"
      phoneTabs={["/logistics", "/logistics/stock", "/logistics/storage", "/logistics/summary"]}
    >
      {children}
    </AppShell>
  );
}
