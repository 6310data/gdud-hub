import { accessibleModules } from "@gdud/auth";
import { Avatar, Icon } from "@gdud/ui";
import { SideNav, TabBar, type NavItem } from "@/components/nav";
import { displayName, requireSession } from "@/lib/session";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const { user, claims } = await requireSession();
  const name = displayName(user, claims);

  const items: NavItem[] = [
    { href: "/", label: "בית", icon: "home" },
    ...accessibleModules(user).map((m) => ({ href: m.href, label: m.name, icon: m.icon })),
  ];

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)] print:block">
      <aside className="sticky top-0 hidden h-dvh flex-col border-e border-separator bg-surface lg:flex print:hidden">
        <div className="flex items-center gap-3 px-5 pb-2 pt-6">
          <div
            className="grid size-9 place-items-center text-lg font-bold text-white"
            style={{ background: "var(--primary)", borderRadius: 10 }}
            aria-hidden="true"
          >
            ג
          </div>
          <span className="tz-headline">מערכת הגדוד</span>
        </div>
        <SideNav items={items} />
        <div className="mt-auto flex items-center gap-3 border-t border-separator p-4">
          <Avatar name={name} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-medium">{name}</div>
            <div className="tz-footnote truncate text-end" dir="ltr">
              {user.email}
            </div>
          </div>
          <form action="/auth/signout" method="post">
            <button className="tz-btn tz-btn-plain" aria-label="יציאה" title="יציאה">
              <Icon name="logout" size={20} />
            </button>
          </form>
        </div>
      </aside>

      {/* pages that mark themselves data-wide (desktop data screens) get the full width */}
      <main className="mx-auto w-full max-w-[960px] px-4 pb-28 pt-6 has-[[data-wide]]:max-w-[1440px] lg:px-8 lg:pb-12 print:max-w-none print:p-0">
        {children}
      </main>

      <TabBar items={items} />
    </div>
  );
}
