import Link from "next/link";
import { can } from "@gdud/auth";
import { LargeTitle, LinkRow, Section } from "@gdud/ui";
import { requireModule } from "@/lib/session";

export const metadata = { title: "ניהול פלוגה" };

/** Picks the company — each company runs its own instance of the company module. */
export default async function CompanyIndexPage() {
  const { user, units, parents } = await requireModule("company");
  const companies = units.filter(
    (u) => u.kind === "company" && u.active && u.code && can(user, "company", "any", u.id, parents),
  );

  return (
    <>
      <LargeTitle sub="שגרת קו, משמרות וניהול פלוגה">ניהול פלוגה</LargeTitle>
      <Section header="פלוגות" footer={companies.length ? undefined : "אין פלוגות משויכות. מנהל המערכת מגדיר פלוגות ב״ניהול מערכת״."}>
        {companies.map((c) => (
          <LinkRow
            key={c.id}
            as={Link}
            href={`/company/${c.code}`}
            leading={<span className="tz-tile" style={{ background: c.color ?? "var(--tile-neutral)" }} />}
            title={c.name}
          />
        ))}
      </Section>
    </>
  );
}
