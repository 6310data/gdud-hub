import { AppShell, type AppNavItem } from "@/components/app-shell";
import { requireCompany } from "@/lib/company/access";
import { moduleRoleLabel } from "@/lib/role-label";
import { displayName } from "@/lib/session";

/**
 * ניהול פלוגה as its own app (spec: docs/superpowers/specs/2026-10-28-company-design.md). A linked
 * soldier gets אני; a company member also gets the company's sections. The sections point at the
 * first company the user covers; each page switches company with its pills.
 */
export default async function CompanyLayout({ children }: { children: React.ReactNode }) {
  const { s, access } = await requireCompany();
  const role = moduleRoleLabel(s, "company");
  const home = access.home;
  const others = access.companies.filter((c) => c !== home).map((c) => `/company/${c.company.id}`);
  const section = (path: string) => ({ href: `/company/${home?.company.id}${path}`, also: others.map((o) => `${o}${path}`) });

  const main: AppNavItem[] = [
    ...(access.personId ? [{ href: "/company/me", label: "אני", icon: "person" } as const] : []),
    ...(home ? [{ ...section(""), label: "הפלוגה", icon: "people" } as const] : []),
    ...(home ? [{ ...section("/signings"), label: "החתמות", icon: "swap" } as const] : []),
    ...(home?.isAdmin ? [{ ...section("/items"), label: "פריטי פלוגה", short: "פריטים", icon: "box" } as const] : []),
    ...(home ? [{ ...section("/reports"), label: "דוחות", icon: "report" } as const] : []),
  ];
  const bottom: AppNavItem[] = home?.isAdmin ? [{ ...section("/settings"), label: "הגדרות", icon: "gear" }] : [];

  return (
    <AppShell
      name="ניהול פלוגה"
      sub={home ? home.company.name : "הציוד, דוח 1 והפרטים שלי"}
      mark={{ icon: "people" }}
      groups={[{ items: main }]}
      bottom={bottom}
      user={{ name: displayName(s.user, s.claims), email: s.user.email, role: role?.role ?? (access.personId ? "חייל" : undefined), roleTone: role?.tone }}
      current="tinted"
    >
      {children}
    </AppShell>
  );
}
