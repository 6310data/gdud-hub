import Link from "next/link";
import { inArmory, pct, sumCounts } from "@gdud/core";
import { desc, schema, withUser } from "@gdud/db";
import { Icon, StockBar } from "@gdud/ui";
import { companiesOf, groupBy, loadHoldings, loadPeople, loadStock, loadStorage } from "@/lib/logistics/data";
import { fmtCount, fmtWhen } from "@/lib/logistics/format";
import { requireModule } from "@/lib/session";
import { EventsTable } from "./_components/events-table";
import { CONDITION_TILE, Kpi, PageHeader, Panel, SmallTile } from "./_components/ui";

export const metadata = { title: "לוגיסטיקה" };

export default async function LogisticsOverview() {
  const s = await requireModule("logistics");

  const data = await withUser(s.claims, async (tx) => {
    const [stock, holdings, people, stored, events] = await Promise.all([
      loadStock(tx),
      loadHoldings(tx),
      loadPeople(tx, s.units, { includeInactive: true }),
      loadStorage(tx),
      tx.select().from(schema.logisticsEvents).orderBy(desc(schema.logisticsEvents.at)).limit(8),
    ]);
    return { stock, holdings, people, stored, events };
  });

  const t = sumCounts(data.stock.counts.values());
  const personById = new Map(data.people.map((p) => [p.id, p]));
  const holdingsByCompany = groupBy(data.holdings, (h) => personById.get(h.personId)?.companyId ?? null);
  const inactiveHolders = new Set(data.holdings.filter((h) => personById.get(h.personId)?.active === false).map((h) => h.personId));
  const companies = companiesOf(s.units);
  const now = new Date();

  return (
    <>
      <PageHeader title="סקירה" sub={`${fmtCount(t.total)} צ׳ים בגדוד · עודכן ${fmtWhen(now, now)}`} />

      <div className="flex flex-wrap items-start gap-[22px]">
        <div className="flex min-w-0 flex-[2_1_520px] flex-col gap-[22px]">
          <Panel title="מצב המלאי" action={<Link href="/logistics/stock" className="text-[13px] font-semibold text-primary no-underline">למחסן</Link>}>
            <div className="flex flex-col gap-2 border-b border-separator px-4 pb-3 pt-3.5">
              <StockBar ok={t.ok} broken={t.broken} brigade={t.brigade} total={t.total} height={8} />
              <span className="text-xs text-ink-muted">
                {pct(t.signed, t.total)}% מהצ׳ים מוחתמים על חיילים · {pct(inArmory(t), t.total)}% בנשקייה
              </span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
              <Kpi href="/logistics/stock?status=ok" value={fmtCount(t.ok)} label="תקין במחסן" tile={<SmallTile {...CONDITION_TILE.ok} />} />
              <Kpi href="/logistics/stock?status=broken" value={fmtCount(t.broken)} label="תקול" tile={<SmallTile {...CONDITION_TILE.broken} />} />
              <Kpi href="/logistics/stock?status=brigade" value={fmtCount(t.brigade)} label="בנשקיית חטיבה" tile={<SmallTile {...CONDITION_TILE.brigade} />} />
              <Kpi href="/logistics/summary" value={fmtCount(t.signed)} label="מוחתמים" tile={<SmallTile color="var(--primary)" icon="person" />} />
            </div>
          </Panel>

          <Panel
            title="פעילות אחרונה"
            action={<Link href="/logistics/log" className="text-[13px] font-semibold text-primary no-underline">לכל הלוג</Link>}
            bodyClassName="overflow-x-auto"
          >
            <EventsTable rows={data.events} />
          </Panel>
        </div>

        <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-[22px]">
          <Panel title="דורש טיפול">
            <AttentionRow
              href="/logistics/stock?status=broken"
              tile={<SmallTile {...CONDITION_TILE.broken} size={28} />}
              title={`${fmtCount(t.broken)} צ׳ים תקולים בנשקייה`}
              sub="חסומים להחתמה עד תיקון"
            />
            <AttentionRow
              href="/logistics/storage"
              tile={<SmallTile color="var(--tile-brigade)" icon="archive" size={28} />}
              title={`${fmtCount(data.stored.length)} פריטים באפסון`}
              sub="נשארים מוחתמים על החיילים"
            />
            {inactiveHolders.size ? (
              <AttentionRow
                href="/logistics/people?unit=all&inactive=1"
                tile={<SmallTile color="var(--tile-document)" icon="alert" size={28} />}
                title={`${inactiveHolders.size} חיילים שהוסרו מהאלפון עם ציוד מוחתם`}
                sub="יש לזכות את הציוד"
              />
            ) : null}
          </Panel>

          <Panel title="פלוגות" action={<span className="text-xs text-ink-muted">פריטים מוחתמים</span>}>
            {companies.map((c) => (
              <CompanyRow key={c.id} href={`/logistics/people?unit=${c.id}`} name={c.name} count={holdingsByCompany.get(c.id)?.length ?? 0} />
            ))}
            {holdingsByCompany.get(null)?.length ? (
              <CompanyRow href="/logistics/people?unit=none" name="ללא פלוגה" count={holdingsByCompany.get(null)!.length} />
            ) : null}
          </Panel>
        </div>
      </div>
    </>
  );
}

function AttentionRow({ href, tile, title, sub }: { href: string; tile: React.ReactNode; title: string; sub: string }) {
  return (
    <Link href={href} className="tz-row">
      {tile}
      <span className="tz-row-body">
        <span className="tz-row-title text-[14px]">
          {title}
          <span className="tz-row-sub text-xs">{sub}</span>
        </span>
        <Icon name="chevron" size={15} className="tz-chevron" />
      </span>
    </Link>
  );
}

function CompanyRow({ href, name, count }: { href: string; name: string; count: number }) {
  return (
    <Link href={href} className="tz-row">
      <span className="tz-row-body min-h-[42px] py-0">
        <span className="tz-row-title text-[14px]">{name}</span>
        <span className="tz-num text-[14px] text-ink-muted">{fmtCount(count)}</span>
        <Icon name="chevron" size={14} className="tz-chevron" />
      </span>
    </Link>
  );
}
