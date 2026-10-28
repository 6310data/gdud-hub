"use client";
/**
 * The frame of one module ("mini app"): its own sidebar on desktop, its own tab bar on the phone.
 * Other modules are reached through the hub ("כל המחלקות" → /), never from inside a module.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Avatar, Icon, type IconName } from "@gdud/ui";
import { useCanGoBack } from "./nav-history";

export interface AppNavItem {
  href: string;
  label: string;
  icon: IconName;
  /** shorter label for the phone tab bar */
  short?: string;
  badge?: ReactNode;
  /** active only on this exact path (a module's home) */
  exact?: boolean;
  /** other path prefixes that belong to this section */
  also?: readonly string[];
}

export interface AppNavGroup {
  title?: string;
  items: readonly AppNavItem[];
}

export interface AppShellProps {
  name: string;
  sub?: string;
  /** short text in the app tile (e.g. "ד1"), or an icon */
  mark: { text: string } | { icon: IconName };
  groups: readonly AppNavGroup[];
  /** links pinned above the user card (settings) */
  bottom?: readonly AppNavItem[];
  search?: { action: string; placeholder: string };
  user: { name: string; email: string; role?: string; roleTone?: "admin" | "signed" };
  /** how the current section is marked: raised white pill (דוח 1) or tinted (לוגיסטיקה) */
  current?: "raised" | "tinted";
  /** hrefs shown in the phone tab bar, in order (default: the first sections); the rest go under "עוד" */
  phoneTabs?: readonly string[];
  /** where "חזרה" goes when there is no in-app page to go back to (default: the first section) */
  home?: string;
  children: ReactNode;
}

const MAX_TABS = 5;

function isActive(pathname: string, it: AppNavItem) {
  const under = (p: string) => pathname === p || pathname.startsWith(`${p}/`);
  return it.exact ? pathname === it.href : under(it.href) || (it.also ?? []).some(under);
}

function Mark({ mark }: { mark: AppShellProps["mark"] }) {
  return (
    <span className="tz-app-mark" aria-hidden="true">
      {"text" in mark ? mark.text : <Icon name={mark.icon} size={19} />}
    </span>
  );
}

function NavLink({ it, active }: { it: AppNavItem; active: boolean }) {
  return (
    <Link href={it.href} className="tz-app-link" aria-current={active ? "page" : undefined}>
      <Icon name={it.icon} size={19} />
      <span className="min-w-0 flex-1 truncate">{it.label}</span>
      {it.badge !== undefined ? <span className="tz-app-badge">{it.badge}</span> : null}
    </Link>
  );
}

/**
 * "חזרה": back to the page the user came from inside the app, or to the module's home when the page
 * was opened directly. Not shown on the module's home itself when there is nothing to go back to.
 */
function BackButton({ home, className, desktop }: { home: string; className?: string; desktop?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const canGoBack = useCanGoBack();
  if (!canGoBack && pathname === home) return null;
  const button = (
    <button type="button" className={`tz-app-back border-0 bg-transparent ${className ?? ""}`} onClick={() => (canGoBack ? router.back() : router.push(home))}>
      <Icon name="chevron" size={16} />
      חזרה
    </button>
  );
  // on the desktop the phone header is hidden: the button sits above the page
  return desktop ? <div className="hidden lg:block">{button}</div> : button;
}

function SignOut() {
  return (
    <form action="/auth/signout" method="post">
      <button className="tz-icon-btn" aria-label="יציאה" title="יציאה">
        <Icon name="logout" size={19} />
      </button>
    </form>
  );
}

export function AppShell({ name, sub, mark, groups, bottom = [], search, user, current = "tinted", phoneTabs, home, children }: AppShellProps) {
  const pathname = usePathname();
  // the "עוד" sheet belongs to the page it was opened on: navigating closes it
  const [moreOn, setMoreOn] = useState<string | null>(null);
  const moreOpen = moreOn === pathname;
  const setMoreOpen = (open: boolean) => setMoreOn(open ? pathname : null);

  const all = [...groups.flatMap((g) => g.items), ...bottom];
  // the most specific section wins (e.g. /logistics/stock over /logistics)
  const activeHref = all.filter((it) => isActive(pathname, it)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const ordered = phoneTabs
    ? [...phoneTabs.flatMap((href) => all.filter((it) => it.href === href)), ...all.filter((it) => !phoneTabs.includes(it.href))]
    : all;
  const tabs = ordered.length <= MAX_TABS ? ordered : ordered.slice(0, MAX_TABS - 1);
  const rest = ordered.length <= MAX_TABS ? [] : ordered.slice(MAX_TABS - 1);
  const restActive = rest.some((it) => it.href === activeHref);
  const homeHref = home ?? all[0]?.href ?? "/";

  return (
    <div className="tz-app">
      <aside className="tz-app-side" data-current={current} aria-label={name}>
        <Link href="/" className="tz-app-back">
          <Icon name="chevron" size={16} />
          כל המחלקות
        </Link>
        <div className="tz-app-brand">
          <Mark mark={mark} />
          <span className="flex min-w-0 flex-col">
            <span className="tz-app-name truncate">{name}</span>
            {sub ? <span className="tz-app-sub truncate">{sub}</span> : null}
          </span>
        </div>
        {search ? (
          <form action={search.action} role="search" className="tz-app-search">
            <Icon name="search" size={15} />
            <input type="search" name="q" placeholder={search.placeholder} aria-label={search.placeholder} autoComplete="off" />
          </form>
        ) : null}
        {groups.map((g, i) => (
          <nav key={g.title ?? i} className="tz-app-nav" aria-label={g.title ?? name}>
            {g.title ? <span className="tz-app-group">{g.title}</span> : null}
            {g.items.map((it) => (
              <NavLink key={it.href} it={it} active={activeHref === it.href} />
            ))}
          </nav>
        ))}
        <div className="mt-auto flex flex-col gap-2">
          {bottom.length ? (
            <nav className="tz-app-nav" aria-label="הגדרות">
              {bottom.map((it) => (
                <NavLink key={it.href} it={it} active={activeHref === it.href} />
              ))}
            </nav>
          ) : null}
          <div className="tz-app-user">
            <Avatar name={user.name} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[13px] font-semibold">{user.name}</span>
              {user.role ? (
                <span className="tz-app-role" data-tone={user.roleTone}>
                  {user.role}
                </span>
              ) : (
                <span className="tz-app-sub truncate text-end" dir="ltr">
                  {user.email}
                </span>
              )}
            </span>
            <SignOut />
          </div>
        </div>
      </aside>

      <header className="tz-app-top">
        <BackButton home={homeHref} className="-ms-1.5 flex-none" />
        <Mark mark={mark} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] font-bold leading-5">{name}</span>
          {sub ? <span className="tz-app-sub truncate">{sub}</span> : null}
        </span>
        {search ? (
          <Link href={search.action} className="tz-icon-btn" aria-label={search.placeholder}>
            <Icon name="search" size={20} />
          </Link>
        ) : null}
        <Link href="/" className="tz-icon-btn" aria-label="כל המחלקות" title="כל המחלקות">
          <Icon name="apps" size={21} />
        </Link>
      </header>

      <main className="tz-app-main">
        <BackButton home={homeHref} desktop />
        {children}
      </main>

      <nav className="tz-tabs fixed inset-x-0 bottom-0 z-20 lg:hidden" aria-label={name}>
        {tabs.map((it) => (
          <Link key={it.href} href={it.href} className="tz-tab" aria-current={activeHref === it.href ? "page" : undefined}>
            <Icon name={it.icon} size={25} />
            <span className="max-w-full truncate">{it.short ?? it.label}</span>
          </Link>
        ))}
        {rest.length ? (
          <button
            type="button"
            className="tz-tab border-0 bg-transparent"
            aria-current={restActive ? "page" : undefined}
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(true)}
          >
            <Icon name="more" size={25} />
            <span>עוד</span>
          </button>
        ) : null}
      </nav>

      {moreOpen ? (
        <>
          <button type="button" className="tz-scrim lg:hidden" aria-label="סגירה" onClick={() => setMoreOpen(false)} />
          <div className="tz-sheet lg:hidden" role="dialog" aria-modal="true" aria-label="עוד">
            <div className="tz-grabber" />
            <div className="tz-group mx-4">
              {rest.map((it) => (
                <Link key={it.href} href={it.href} className="tz-row" aria-current={activeHref === it.href ? "page" : undefined}>
                  <span className="tz-tile" style={{ background: "var(--primary)" }}>
                    <Icon name={it.icon} size={17} />
                  </span>
                  <span className="tz-row-body">
                    <span className="tz-row-title">{it.label}</span>
                    <Icon name="chevron" size={17} className="tz-chevron" />
                  </span>
                </Link>
              ))}
            </div>
            <div className="tz-group mx-4 mt-4">
              <Link href="/" className="tz-row">
                <span className="tz-tile" style={{ background: "var(--tile-neutral)" }}>
                  <Icon name="apps" size={17} />
                </span>
                <span className="tz-row-body">
                  <span className="tz-row-title">כל המחלקות</span>
                  <Icon name="chevron" size={17} className="tz-chevron" />
                </span>
              </Link>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
