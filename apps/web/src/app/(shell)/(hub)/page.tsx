import Link from "next/link";
import { redirect } from "next/navigation";
import { accessibleModules } from "@gdud/auth";
import { getModule } from "@gdud/core";
import { Chip, Icon, LargeTitle, LinkRow, Section } from "@gdud/ui";
import { displayName, requireSession } from "@/lib/session";

const TILE_COLOR = {
  logistics: "var(--tile-ok)",
  doch1: "var(--primary)",
  company: "var(--tile-brigade)",
  kesher: "var(--tile-broken)",
  core: "var(--tile-neutral)",
} as const;

/**
 * The hub: one card per module the user may open. Each module opens as its own app. A linked
 * soldier also opens ניהול פלוגה (their אני page); with nothing else, they land there directly.
 */
export default async function HomePage() {
  const { user, claims, personId } = await requireSession();
  const modules = accessibleModules(user);
  const company = getModule("company");
  if (personId && company && !modules.some((m) => m.id === "company")) {
    if (!modules.length) redirect("/company/me");
    modules.push(company as (typeof modules)[number]);
  }
  const first = displayName(user, claims).split(" ")[0];

  return (
    <>
      <LargeTitle sub="בחרו מחלקה. כל מחלקה נפתחת כאפליקציה משלה, ומכל מקום אפשר לחזור לכאן.">שלום, {first}</LargeTitle>

      {modules.length === 0 ? (
        <Section footer="מנהל המערכת צריך לשייך אותך למחלקה לפני שתוכל להתחיל.">
          <div className="p-4 text-ink-muted">עדיין אין לך הרשאה לאף מחלקה.</div>
          <LinkRow as={Link} href="/join" title="אני חייל בגדוד — קישור החשבון לפרטים שלי" />
        </Section>
      ) : (
        <section aria-label="המחלקות שלי" className="grid gap-3 sm:grid-cols-2">
          {modules.map((m) => (
            <Link
              key={m.id}
              href={m.href}
              className="tz-card flex items-center gap-4 p-4 text-ink no-underline transition-[transform,box-shadow] duration-150 ease-out hover:shadow-[var(--segment-thumb)] active:scale-[.98]"
            >
              <span
                className="grid size-12 flex-none place-items-center rounded-[12px] text-white"
                style={{ background: TILE_COLOR[m.id] }}
                aria-hidden="true"
              >
                <Icon name={m.icon} size={24} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="tz-headline">{m.name}</span>
                <span className="tz-footnote">{m.description}</span>
              </span>
              {m.status === "planned" ? <Chip tone="signed">בבנייה</Chip> : <Icon name="chevron" size={18} className="tz-chevron" />}
            </Link>
          ))}
        </section>
      )}
    </>
  );
}
