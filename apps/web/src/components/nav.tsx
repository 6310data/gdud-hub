"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@gdud/ui";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Desktop: sidebar links. */
export function SideNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="tz-sidebar" aria-label="ניווט ראשי">
      {items.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          className="tz-side-link"
          aria-current={isActive(pathname, it.href) ? "page" : undefined}
        >
          <Icon name={it.icon} size={20} />
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

/** Phone: translucent bottom tab bar. */
export function TabBar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="tz-tabs fixed inset-x-0 bottom-0 z-20 lg:hidden print:hidden" aria-label="ניווט ראשי">
      {items.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          className="tz-tab"
          aria-current={isActive(pathname, it.href) ? "page" : undefined}
        >
          <Icon name={it.icon} size={25} />
          <span className="max-w-full truncate">{it.label}</span>
        </Link>
      ))}
    </nav>
  );
}
