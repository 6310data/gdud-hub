"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@gdud/ui";

export type Doch1Section = "today" | "overview" | "brigade" | "copy" | "import" | "settings";

const SECTIONS: Array<{ id: Doch1Section; href: string; label: string; icon: IconName }> = [
  { id: "today", href: "/doch1/today", label: "היום", icon: "check" },
  { id: "overview", href: "/doch1", label: "סקירה", icon: "home" },
  { id: "brigade", href: "/doch1/brigade", label: "לחטיבה", icon: "flag" },
  { id: "copy", href: "/doch1/copy", label: "העתקה לגיליון", icon: "table" },
  { id: "import", href: "/doch1/import", label: "ייבוא", icon: "doc" },
  { id: "settings", href: "/doch1/settings", label: "הגדרות", icon: "gear" },
];

const active = (pathname: string, href: string) =>
  href === "/doch1" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

/** Module title + the sections this user may open. */
export function Doch1Nav({ sections, roundName }: { sections: Doch1Section[]; roundName: string | null }) {
  const pathname = usePathname();
  const shown = SECTIONS.filter((s) => sections.includes(s.id));
  return (
    <div className="tz-no-print flex flex-col gap-3">
      <span className="flex items-center gap-2.5">
        <span className="grid size-[34px] flex-none place-items-center rounded-[9px] bg-primary text-white" aria-hidden="true">
          <Icon name="list" size={19} />
        </span>
        <span className="text-[15px] font-bold">דוח 1</span>
        {roundName ? <span className="tz-footnote">· {roundName}</span> : null}
      </span>
      {shown.length > 1 ? (
        <nav className="tz-pills" aria-label="דוח 1">
          {shown.map((s) => (
            <Link key={s.href} href={s.href} className="tz-pill" aria-current={active(pathname, s.href) ? "page" : undefined}>
              <Icon name={s.icon} size={16} />
              {s.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
