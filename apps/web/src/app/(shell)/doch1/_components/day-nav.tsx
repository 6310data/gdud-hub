"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addDays, hebrewDayLabel, type Day } from "@gdud/core";
import { Icon } from "@gdud/ui";
import { dayHref } from "@/lib/doch1/format";

/**
 * Previous / next day, a date picker and "היום", within the round (min..max).
 * Every link keeps the page's other params (`params`), e.g. the selected unit.
 */
export function DayNav({
  day,
  today,
  min,
  max,
  path,
  params = {},
}: {
  day: Day;
  today: Day;
  min: Day;
  max: Day;
  path: string;
  params?: Record<string, string | null | undefined>;
}) {
  const router = useRouter();
  const href = (d: Day) => dayHref(path, params, d === today ? null : d);
  const prev = day > min ? addDays(day, -1) : null;
  const next = day < max ? addDays(day, 1) : null;
  const todayInRound = today >= min && today <= max;

  return (
    <nav className="flex flex-wrap items-center gap-1" aria-label="מעבר בין ימים">
      {prev ? (
        <Link href={href(prev)} className="tz-btn tz-btn-plain tz-btn-sm" aria-label={`יום קודם · ${hebrewDayLabel(prev)}`}>
          <Icon name="chevron" size={16} className="rotate-180" />
          יום קודם
        </Link>
      ) : null}
      <label>
        <span className="sr-only">בחירת יום</span>
        <input
          type="date"
          className="tz-input w-auto min-h-9"
          key={day}
          defaultValue={day}
          min={min}
          max={max}
          onChange={(e) => {
            const d = e.target.value;
            if (d && d >= min && d <= max) router.push(href(d));
          }}
        />
      </label>
      {next ? (
        <Link href={href(next)} className="tz-btn tz-btn-plain tz-btn-sm" aria-label={`יום הבא · ${hebrewDayLabel(next)}`}>
          יום הבא
          <Icon name="chevron" size={16} />
        </Link>
      ) : null}
      {todayInRound && day !== today ? (
        <Link href={href(today)} className="tz-btn tz-btn-tinted tz-btn-sm">
          היום
        </Link>
      ) : null}
    </nav>
  );
}
