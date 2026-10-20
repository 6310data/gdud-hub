"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@gdud/ui";

const SECTIONS: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/logistics", label: "סקירה", icon: "home" },
  { href: "/logistics/stock", label: "מחסן", icon: "box" },
  { href: "/logistics/people", label: "פלוגות ואלפון", icon: "people" },
  { href: "/logistics/summary", label: "סיכום אמצעים", icon: "table" },
  { href: "/logistics/storage", label: "אפסון", icon: "archive" },
  { href: "/logistics/log", label: "לוג פעולות", icon: "clock" },
];

const active = (pathname: string, href: string) =>
  href === "/logistics" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

/** Section tabs + global search + the two main actions (admins). */
export function LogisticsNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  return (
    <div className="tz-no-print flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-2.5">
          <span className="grid size-[34px] flex-none place-items-center rounded-[9px] bg-primary text-white" aria-hidden="true">
            <Icon name="logo" size={19} />
          </span>
          <span className="text-[15px] font-bold">לוגיסטיקה גדודית</span>
        </span>
        <form action="/logistics/search" role="search" className="tz-search min-w-[200px] flex-1 lg:max-w-[340px]">
          <Icon name="search" size={15} />
          <input type="search" name="q" placeholder="חיפוש חייל, צ׳ או פריט" aria-label="חיפוש חייל, צ׳ או פריט" autoComplete="off" />
        </form>
        {isAdmin ? (
          <span className="flex gap-2 max-sm:w-full">
            <Link href="/logistics/return" className="tz-btn tz-btn-tinted tz-btn-sm max-sm:flex-1">
              <Icon name="undo" size={16} />
              זיכוי
            </Link>
            <Link href="/logistics/sign" className="tz-btn tz-btn-filled tz-btn-sm max-sm:flex-1">
              <Icon name="pencil" size={16} />
              החתמה חדשה
            </Link>
          </span>
        ) : null}
      </div>
      <nav className="tz-pills" aria-label="לוגיסטיקה">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="tz-pill" aria-current={active(pathname, s.href) ? "page" : undefined}>
            <Icon name={s.icon} size={16} />
            {s.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
