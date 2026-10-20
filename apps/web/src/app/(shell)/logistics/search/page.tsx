import Link from "next/link";
import { z } from "zod";
import { emptyCounts, matches, normalizeSerial } from "@gdud/core";
import { withUser } from "@gdud/db";
import { Avatar, Chip, LinkRow, Section, Serial, Tile } from "@gdud/ui";
import { loadHoldings, loadPeople, loadStock, personPlace } from "@/lib/logistics/data";
import { requireModule } from "@/lib/session";
import { Empty, PageHeader, SerialChip } from "../_components/ui";

export const metadata = { title: "חיפוש" };

const MAX = 12;

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requireModule("logistics");
  const { q = "" } = z.object({ q: z.string().trim().max(80).optional().catch(undefined) }).parse(await searchParams);

  const { stock, people, holdings } = await withUser(s.claims, async (tx) => ({
    stock: await loadStock(tx),
    people: await loadPeople(tx, s.units),
    holdings: await loadHoldings(tx),
  }));
  const ready = q.length >= 2;
  const itemName = new Map(stock.items.map((i) => [i.id, i.name]));
  const holderBySerial = new Map(holdings.map((h) => [h.serialId, h.personId]));
  const personById = new Map(people.map((p) => [p.id, p]));
  const heldCount = new Map<string, number>();
  for (const h of holdings) heldCount.set(h.personId, (heldCount.get(h.personId) ?? 0) + 1);

  const foundPeople = ready ? people.filter((p) => matches(q, p.name, p.personalNumber, p.phone)).slice(0, MAX) : [];
  const nq = normalizeSerial(q).toLowerCase();
  const foundSerials = ready && nq ? stock.serials.filter((x) => x.serial.toLowerCase().includes(nq)).slice(0, MAX) : [];
  const foundItems = ready ? stock.items.filter((i) => matches(q, i.name, i.category, i.subcategory)).slice(0, 8) : [];
  const nothing = ready && !foundPeople.length && !foundSerials.length && !foundItems.length;

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4">
      <PageHeader title="חיפוש" sub={ready ? `תוצאות עבור "${q}"` : "הקלידו לפחות 2 תווים: שם חייל, מספר אישי, צ׳ או פריט"} />
      <form role="search" className="tz-search bg-surface">
        <input type="search" name="q" defaultValue={q} placeholder="חיפוש חייל, צ׳ או פריט" aria-label="חיפוש" autoFocus />
      </form>

      {nothing ? (
        <div className="tz-card">
          <Empty>לא נמצא כלום</Empty>
        </div>
      ) : null}

      {foundPeople.length ? (
        <Section header="חיילים">
          {foundPeople.map((p) => (
            <LinkRow
              key={p.id}
              as={Link}
              href={`/logistics/people?person=${p.id}`}
              leading={<Avatar name={p.name} />}
              title={p.name}
              sub={[personPlace(p), p.personalNumber].filter(Boolean).join(" · ") || "ללא שיבוץ"}
              trailing={<Chip tone="signed">{heldCount.get(p.id) ?? 0}</Chip>}
            />
          ))}
        </Section>
      ) : null}

      {foundSerials.length ? (
        <Section header="צ׳ים">
          {foundSerials.map((x) => {
            const holder = personById.get(holderBySerial.get(x.id) ?? "");
            return (
              <LinkRow
                key={x.id}
                as={Link}
                href={`/logistics/serials/${x.id}`}
                title={itemName.get(x.itemId) ?? ""}
                sub={<Serial>{x.serial}</Serial>}
                trailing={holder ? <Chip tone="signed">{holder.name}</Chip> : <SerialChip condition={x.condition} held={x.held} />}
              />
            );
          })}
        </Section>
      ) : null}

      {foundItems.length ? (
        <Section header="פריטים">
          {foundItems.map((i) => {
            const c = stock.counts.get(i.id) ?? emptyCounts();
            return (
              <LinkRow
                key={i.id}
                as={Link}
                href={`/logistics/stock?item=${i.id}`}
                leading={<Tile icon="box" color="ok" />}
                title={i.name}
                sub={`${[i.category, i.subcategory].filter(Boolean).join(" / ")}${i.category || i.subcategory ? " · " : ""}${c.ok} פנויים · ${c.signed} חתום`}
              />
            );
          })}
        </Section>
      ) : null}
    </div>
  );
}
