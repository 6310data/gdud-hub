import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { emptyCounts, matches, sumCounts, type Condition, type StockCounts } from "@gdud/core";
import { withUser } from "@gdud/db";
import { Icon, Serial, StockBar } from "@gdud/ui";
import { logisticsAccess } from "@/lib/logistics/access";
import { loadHoldings, loadPeople, loadStock, type ItemVM, type SerialVM } from "@/lib/logistics/data";
import { fmtCount } from "@/lib/logistics/format";
import { requireModule } from "@/lib/session";
import { ClickableRow } from "../_components/clickable-row";
import { KitStandard } from "../_components/kit-editor";
import { Empty, NumCell, PageHeader, SerialChip, withParams } from "../_components/ui";

export const metadata = { title: "מחסן" };

const STATUS_TABS = [
  { id: "", label: "הכל" },
  { id: "ok", label: "תקין" },
  { id: "broken", label: "תקול" },
  { id: "brigade", label: "חטיבה" },
] as const;

const paramsSchema = z.object({
  q: z.string().max(80).optional().catch(undefined),
  status: z.enum(["ok", "broken", "brigade"]).optional().catch(undefined),
  item: z.uuid().optional().catch(undefined),
  tab: z.enum(["store", "brigade", "signed"]).optional().catch(undefined),
});

export default async function StockPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requireModule("logistics");
  const access = logisticsAccess(s);
  const sp = paramsSchema.parse(await searchParams);
  const current = { q: sp.q, status: sp.status, item: sp.item, tab: sp.tab };

  const stock = await withUser(s.claims, (tx) => loadStock(tx));
  const serialsByItem = new Map<string, SerialVM[]>();
  for (const x of stock.serials) serialsByItem.set(x.itemId, [...(serialsByItem.get(x.itemId) ?? []), x]);

  const rows = stock.items.filter((it) => {
    const c = stock.counts.get(it.id) ?? emptyCounts();
    if (sp.status && c[sp.status as Condition] === 0) return false;
    if (!sp.q) return true;
    return matches(sp.q, it.name, it.category, it.subcategory) || (serialsByItem.get(it.id) ?? []).some((x) => matches(sp.q!, x.serial));
  });
  const totals = sumCounts(rows.map((it) => stock.counts.get(it.id) ?? emptyCounts()));
  const selected = sp.item ? stock.items.find((it) => it.id === sp.item) : undefined;
  if (sp.item && !selected) notFound();

  return (
    <>
      <PageHeader
        title="מחסן"
        sub={`${fmtCount(totals.ok + totals.broken)} צ׳ים בנשקייה · ${fmtCount(totals.brigade)} בחטיבה`}
        actions={
          <>
            <Link href="/logistics/stock/kits" className="tz-btn tz-btn-tinted tz-btn-sm">
              תקן ציוד משלים
            </Link>
            {access.isStockAdmin ? (
              <>
                <Link href="/logistics/stock/new" className="tz-btn tz-btn-tinted tz-btn-sm">
                  פריט חדש
                </Link>
                <Link href={withParams("/logistics/stock/add", {}, { item: sp.item })} className="tz-btn tz-btn-filled tz-btn-sm">
                  <Icon name="plus" size={16} />
                  הוספת צ׳ים
                </Link>
              </>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <form className="tz-search min-w-[220px] flex-1 bg-surface lg:max-w-[320px]" role="search">
          {sp.status ? <input type="hidden" name="status" value={sp.status} /> : null}
          <Icon name="search" size={15} />
          <input type="search" name="q" defaultValue={sp.q} placeholder="סינון לפי פריט או צ׳" aria-label="סינון לפי פריט או צ׳" />
        </form>
        <nav className="tz-pills" aria-label="סינון לפי מצב">
          {STATUS_TABS.map((t) => (
            <Link
              key={t.id}
             
              aria-current={((sp.status ?? "") === t.id) ? "page" : undefined}
              className="tz-pill"
              href={withParams("/logistics/stock", current, { status: t.id || null, item: null, tab: null })}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid items-start gap-[22px] lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="tz-table-wrap order-2 lg:order-1">
          {rows.length ? (
            <table className="tz-table">
              <thead>
                <tr>
                  <th scope="col">פריט</th>
                  <th scope="col">פנויים</th>
                  <th scope="col">תקול</th>
                  <th scope="col">חטיבה</th>
                  <th scope="col">חתום</th>
                  <th scope="col">סה״כ</th>
                  <th scope="col" className="max-md:hidden">
                    פיזור
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((it) => (
                  <ItemRow key={it.id} item={it} c={stock.counts.get(it.id) ?? emptyCounts()} selected={it.id === sp.item} href={withParams("/logistics/stock", current, { item: it.id, tab: null })} />
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">סה״כ</th>
                  <NumCell n={totals.ok} />
                  <NumCell n={totals.broken} />
                  <NumCell n={totals.brigade} />
                  <NumCell n={totals.signed} />
                  <NumCell n={totals.total} />
                  <td className="max-md:hidden" />
                </tr>
              </tfoot>
            </table>
          ) : (
            <Empty>{stock.items.length ? "אין תוצאות" : "אין עדיין פריטים במלאי"}</Empty>
          )}
        </div>

        {selected ? (
          <ItemInspector
            item={selected}
            c={stock.counts.get(selected.id) ?? emptyCounts()}
            serials={serialsByItem.get(selected.id) ?? []}
            tab={sp.tab}
            current={current}
            canEdit={access.isStockAdmin}
          />
        ) : (
          <aside className="tz-card order-1 hidden p-6 text-center text-[14px] text-ink-muted lg:order-2 lg:block">בחרו פריט כדי לראות את הצ׳ים שלו</aside>
        )}
      </div>
    </>
  );
}

function ItemRow({ item, c, selected, href }: { item: ItemVM; c: StockCounts; selected: boolean; href: string }) {
  return (
    <ClickableRow href={href} selected={selected}>
      <th scope="row">
        <Link href={href} scroll={false} className="tz-cell-link">
          <span className="block text-[14px]">{item.name}</span>
          {item.category ? <span className="block text-xs text-ink-muted">{item.category}</span> : null}
        </Link>
      </th>
      <NumCell n={c.ok} strong />
      <NumCell n={c.broken} />
      <NumCell n={c.brigade} />
      <NumCell n={c.signed} />
      <NumCell n={c.total} />
      <td className="w-[120px] max-md:hidden">
        <StockBar ok={c.ok} broken={c.broken} brigade={c.brigade} total={c.total} />
      </td>
    </ClickableRow>
  );
}

async function ItemInspector({
  item,
  c,
  serials,
  tab,
  current,
  canEdit,
}: {
  item: ItemVM;
  c: StockCounts;
  serials: SerialVM[];
  tab?: "store" | "brigade" | "signed";
  current: Record<string, string | undefined>;
  canEdit: boolean;
}) {
  const store = serials.filter((x) => !x.held && x.condition !== "brigade");
  const brigade = serials.filter((x) => !x.held && x.condition === "brigade");
  const active = tab ?? (store.length ? "store" : c.signed ? "signed" : "brigade");

  return (
    <aside aria-label="פרטי פריט" className="order-1 flex flex-col gap-3 lg:sticky lg:top-6 lg:order-2">
      <div className="tz-card flex flex-col gap-3.5 p-4">
        <div className="flex items-start gap-2">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[17px] font-semibold">{item.name}</span>
            <span className="tz-footnote">{[item.category, item.subcategory, `${fmtCount(c.total)} צ׳ים`].filter(Boolean).join(" · ")}</span>
          </span>
          <Link href={withParams("/logistics/stock", current, { item: null, tab: null })} scroll={false} className="tz-btn tz-btn-plain min-h-0 p-1" aria-label="סגירת פרטי הפריט">
            <Icon name="close" size={18} />
          </Link>
        </div>
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            [c.ok, "תקין", "var(--status-ok)"],
            [c.broken, "תקול", "var(--status-broken)"],
            [c.brigade, "חטיבה", "var(--status-brigade)"],
            [c.signed, "חתום", "var(--status-signed)"],
          ].map(([n, label, color]) => (
            <span key={label as string} className="flex flex-col rounded-control bg-ground py-2">
              <span className="tz-num text-[18px] font-semibold" style={{ color: color as string }}>
                {fmtCount(n as number)}
              </span>
              <span className="text-xs text-ink-muted">{label}</span>
            </span>
          ))}
        </div>
        <nav className="tz-pills" aria-label="צ׳ים לפי מיקום">
          {(
            [
              ["store", `במחסן ${store.length}`],
              ["brigade", `חטיבה ${brigade.length}`],
              ["signed", `חתום ${c.signed}`],
            ] as const
          ).map(([id, label]) => (
            <Link key={id} aria-current={(active === id) ? "page" : undefined} className="tz-pill bg-ground" scroll={false} href={withParams("/logistics/stock", current, { tab: id })}>
              {label}
            </Link>
          ))}
        </nav>
        {active === "signed" ? <SignedList itemId={item.id} /> : <SerialList list={active === "store" ? store : brigade} />}
        {canEdit ? (
          <Link href={`/logistics/stock/add?item=${item.id}`} className="tz-btn tz-btn-tinted tz-btn-sm">
            <Icon name="plus" size={16} />
            הוספת צ׳ים לפריט הזה
          </Link>
        ) : null}
      </div>
      <div className="tz-card p-4">
        <KitStandard key={item.id} itemId={item.id} kit={item.kit} canEdit={canEdit} />
      </div>
    </aside>
  );
}

const MAX_LIST = 60;

function SerialList({ list }: { list: SerialVM[] }) {
  if (!list.length) return <p className="tz-footnote m-0 text-center">אין צ׳ים כאן</p>;
  return (
    <div className="flex max-h-[420px] flex-col overflow-y-auto">
      {list.slice(0, MAX_LIST).map((x) => (
        <Link key={x.id} href={`/logistics/serials/${x.id}`} className="flex items-center justify-between gap-2 border-b border-separator py-2 text-ink no-underline last:border-0">
          <Serial>{x.serial}</Serial>
          <SerialChip condition={x.condition} held={x.held} />
        </Link>
      ))}
      {list.length > MAX_LIST ? <p className="tz-footnote m-0 pt-2 text-center">מוצגים {MAX_LIST} מתוך {list.length}</p> : null}
    </div>
  );
}

/** Who holds this item type (only soldiers the user may see). */
async function SignedList({ itemId }: { itemId: string }) {
  const s = await requireModule("logistics");
  const { holdings, people } = await withUser(s.claims, async (tx) => ({
    holdings: await loadHoldings(tx, { itemId }),
    people: await loadPeople(tx, s.units, { includeInactive: true }),
  }));
  const byId = new Map(people.map((p) => [p.id, p]));
  if (!holdings.length) return <p className="tz-footnote m-0 text-center">לא מוחתם על אף חייל במסגרות שלך</p>;
  return (
    <div className="flex max-h-[420px] flex-col overflow-y-auto">
      {holdings.slice(0, MAX_LIST * 2).map((h) => {
        const p = byId.get(h.personId);
        return (
          <Link key={h.id} href={`/logistics/serials/${h.serialId}`} className="flex items-center justify-between gap-2 border-b border-separator py-2 text-ink no-underline last:border-0">
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[14px]">{p?.name ?? "—"}</span>
              <span className="text-xs text-ink-muted">{p?.companyName ?? ""}</span>
            </span>
            <Serial>{h.serial}</Serial>
          </Link>
        );
      })}
    </div>
  );
}
