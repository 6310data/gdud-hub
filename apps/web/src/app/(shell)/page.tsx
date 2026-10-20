import Link from "next/link";
import { accessibleModules } from "@gdud/auth";
import { Button, Chip, LargeTitle, LinkRow, Section, Tile } from "@gdud/ui";
import { displayName, requireSession } from "@/lib/session";

const TILE_COLOR = { logistics: "ok", doch1: "primary", company: "brigade", kesher: "broken", core: "neutral" } as const;

export default async function HomePage() {
  const { user, claims } = await requireSession();
  const modules = accessibleModules(user);
  const first = displayName(user, claims).split(" ")[0];

  return (
    <>
      <LargeTitle sub={user.email}>שלום, {first}</LargeTitle>

      {modules.length === 0 ? (
        <Section footer="מנהל המערכת צריך לשייך אותך למחלקה לפני שתוכל להתחיל.">
          <div className="p-4 text-ink-muted">עדיין אין לך הרשאה לאף מחלקה.</div>
        </Section>
      ) : (
        <Section header="המחלקות שלי">
          {modules.map((m) => (
            <LinkRow
              key={m.id}
              as={Link}
              href={m.href}
              leading={<Tile icon={m.icon} color={TILE_COLOR[m.id]} />}
              title={m.name}
              sub={m.description}
              trailing={m.status === "planned" ? <Chip tone="signed">בבנייה</Chip> : undefined}
            />
          ))}
        </Section>
      )}

      <form action="/auth/signout" method="post" className="lg:hidden">
        <Button variant="plain" className="w-full">
          יציאה
        </Button>
      </form>
    </>
  );
}
