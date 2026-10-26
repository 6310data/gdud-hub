import Link from "next/link";
import { z } from "zod";
import { byHe, matches } from "@gdud/core";
import { withUser } from "@gdud/db";
import { Icon } from "@gdud/ui";
import { logisticsAccess } from "@/lib/logistics/access";
import { groupBy, loadItems } from "@/lib/logistics/data";
import { fmtCount } from "@/lib/logistics/format";
import { requireModule } from "@/lib/session";
import { KitStandard } from "../../_components/kit-editor";
import { Empty, PageHeader, withParams } from "../../_components/ui";

export const metadata = { title: "תקן ציוד משלים" };

const paramsSchema = z.object({
  q: z.string().max(80).optional().catch(undefined),
  missing: z.literal("1").optional().catch(undefined),
});

/** Every item type with its standard accessory kit (copied into each sign-out); battalion-wide admins edit in place. */
export default async function KitsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requireModule("logistics");
  const canEdit = logisticsAccess(s).isStockAdmin;
  const sp = paramsSchema.parse(await searchParams);
  const current = { q: sp.q, missing: sp.missing };

  const items = await withUser(s.claims, (tx) => loadItems(tx));
  const withoutKit = items.filter((it) => !it.kit.length).length;
  const list = items
    .filter((it) => !sp.missing || !it.kit.length)
    .filter((it) => !sp.q || matches(sp.q, it.name, it.category, it.subcategory) || it.kit.some((k) => matches(sp.q!, k.name)));
  const groups = [...groupBy(list, (it) => it.category ?? "ללא קטגוריה").entries()].sort(([a], [b]) => byHe(a, b));

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4">
      <Link href="/logistics/stock" className="tz-btn tz-btn-plain self-start px-0">
        ‹ מחסן
      </Link>
      <PageHeader
        title="תקן ציוד משלים"
        sub={`${fmtCount(items.length)} פריטים · ${fmtCount(withoutKit)} בלי תקן · הציוד המשלים נכנס לכל החתמה של הפריט`}
      />

      <div className="flex flex-wrap items-center gap-3">
        <form className="tz-search min-w-[220px] flex-1 bg-surface" role="search">
          {sp.missing ? <input type="hidden" name="missing" value="1" /> : null}
          <Icon name="search" size={15} />
          <input type="search" name="q" defaultValue={sp.q} placeholder="חיפוש פריט או ציוד משלים" aria-label="חיפוש פריט או ציוד משלים" />
        </form>
        <nav className="tz-pills" aria-label="סינון">
          <Link className="tz-pill" aria-current={sp.missing ? undefined : "page"} href={withParams("/logistics/stock/kits", current, { missing: null })}>
            הכל <span className="tz-pill-count tz-num">{items.length}</span>
          </Link>
          <Link className="tz-pill" aria-current={sp.missing ? "page" : undefined} href={withParams("/logistics/stock/kits", current, { missing: "1" })}>
            בלי תקן <span className="tz-pill-count tz-num">{withoutKit}</span>
          </Link>
        </nav>
      </div>

      {!canEdit ? <p className="tz-footnote m-0">רק מנהל לוגיסטיקה גדודי יכול לערוך את התקן.</p> : null}

      {groups.length ? (
        groups.map(([category, rows]) => (
          <section key={category} className="flex flex-col gap-1.5">
            <h2 className="tz-section-header">{category}</h2>
            <div className="tz-group">
              {rows.map((it) => (
                <div key={it.id} className="flex flex-col gap-1 border-b border-separator px-4 py-3 last:border-b-0">
                  <span className="text-[15px] font-semibold">{it.name}</span>
                  <KitStandard itemId={it.id} kit={it.kit} canEdit={canEdit} />
                </div>
              ))}
            </div>
          </section>
        ))
      ) : (
        <Empty>{sp.q ? "אין תוצאות" : "אין פריטים בלי תקן"}</Empty>
      )}
    </div>
  );
}
