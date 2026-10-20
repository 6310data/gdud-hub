import Link from "next/link";
import { z } from "zod";
import { byHe, matches } from "@gdud/core";
import { withUser } from "@gdud/db";
import { Icon, Serial } from "@gdud/ui";
import { logisticsAccess } from "@/lib/logistics/access";
import { companiesOf, groupBy, loadPeople, loadStorage } from "@/lib/logistics/data";
import { fmtCount, fmtDate } from "@/lib/logistics/format";
import { requireModule } from "@/lib/session";
import { Empty, NumCell, PageHeader, Panel, withParams } from "../_components/ui";

export const metadata = { title: "אפסון" };

const NONE = "ללא פלוגה";

export default async function StoragePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requireModule("logistics");
  const access = logisticsAccess(s);
  const sp = z
    .object({ unit: z.uuid().optional().catch(undefined), q: z.string().max(80).optional().catch(undefined) })
    .parse(await searchParams);
  const current = { unit: sp.unit, q: sp.q };

  const { stored, people } = await withUser(s.claims, async (tx) => ({
    stored: await loadStorage(tx),
    people: await loadPeople(tx, s.units, { includeInactive: true }),
  }));
  const personById = new Map(people.map((p) => [p.id, p]));
  const rows = stored
    .map((x) => ({ ...x, person: personById.get(x.personId) }))
    .filter((x) => !sp.unit || x.person?.companyId === sp.unit);

  const companies = companiesOf(s.units).filter((c) => stored.some((x) => personById.get(x.personId)?.companyId === c.id));
  const cols = sp.unit ? companies.filter((c) => c.id === sp.unit).map((c) => c.name) : [...companies.map((c) => c.name), ...(rows.some((r) => !r.person?.companyName) ? [NONE] : [])];
  const matrix = groupBy(rows, (r) => r.itemName);
  const items = [...matrix.keys()].sort(byHe);
  const countIn = (item: string, col: string) => (matrix.get(item) ?? []).filter((r) => (r.person?.companyName ?? NONE) === col).length;

  const listRows = rows.filter((r) => !sp.q || matches(sp.q, r.person?.name, r.person?.personalNumber, r.serial, r.itemName));
  const bySoldier = [...groupBy(listRows, (r) => r.personId).entries()].sort(([, a], [, b]) =>
    byHe(a[0]!.person?.companyName ?? "", b[0]!.person?.companyName ?? "") || byHe(a[0]!.person?.name ?? "", b[0]!.person?.name ?? ""),
  );

  return (
    <>
      <PageHeader
        title="אפסון גדודי"
        sub={`${fmtCount(rows.length)} פריטים באפסון · הציוד נשאר מוחתם על החייל`}
        actions={
          access.isAdmin ? (
            <>
              <Link href="/logistics/storage/out" className="tz-btn tz-btn-tinted tz-btn-sm">
                הוצאה מאפסון
              </Link>
              <Link href="/logistics/storage/in" className="tz-btn tz-btn-filled tz-btn-sm">
                <Icon name="archive" size={16} />
                אפסון ציוד
              </Link>
            </>
          ) : null
        }
      />

      <nav className="tz-pills" aria-label="בחירת פלוגה">
        <Link aria-current={(!sp.unit) ? "page" : undefined} className="tz-pill" href={withParams("/logistics/storage", current, { unit: null })}>
          כל הגדוד
        </Link>
        {companies.map((c) => (
          <Link key={c.id} aria-current={(sp.unit === c.id) ? "page" : undefined} className="tz-pill" href={withParams("/logistics/storage", current, { unit: c.id })}>
            {c.name}
          </Link>
        ))}
      </nav>

      <div className="grid items-start gap-[22px] lg:grid-cols-2">
        <Panel title="לפי פריט ופלוגה" bodyClassName="overflow-x-auto">
          {items.length ? (
            <table className="tz-table">
              <thead>
                <tr>
                  <th scope="col">פריט</th>
                  {cols.map((c) => (
                    <th key={c} scope="col">
                      {c}
                    </th>
                  ))}
                  {cols.length > 1 ? <th scope="col">סה״כ</th> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it}>
                    <th scope="row">
                      <Link href={withParams("/logistics/storage", current, { q: it })}>{it}</Link>
                    </th>
                    {cols.map((c) => (
                      <NumCell key={c} n={countIn(it, c)} />
                    ))}
                    {cols.length > 1 ? <NumCell n={matrix.get(it)!.length} strong /> : null}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">סה״כ</th>
                  {cols.map((c) => (
                    <NumCell key={c} n={rows.filter((r) => (r.person?.companyName ?? NONE) === c).length} />
                  ))}
                  {cols.length > 1 ? <NumCell n={rows.length} /> : null}
                </tr>
              </tfoot>
            </table>
          ) : (
            <Empty>אין פריטים באפסון</Empty>
          )}
        </Panel>

        <Panel title={`לפי חייל · ${bySoldier.length}`}>
          <form className="border-b border-separator p-3" role="search">
            {sp.unit ? <input type="hidden" name="unit" value={sp.unit} /> : null}
            <label className="tz-search">
              <Icon name="search" size={15} />
              <input type="search" name="q" defaultValue={sp.q} placeholder="חיפוש: שם / צ׳ / פריט" aria-label="חיפוש באפסון" />
            </label>
          </form>
          {bySoldier.length === 0 ? <Empty>{rows.length ? "לא נמצא" : "אין פריטים באפסון"}</Empty> : null}
          {bySoldier.map(([personId, list]) => {
            const p = list[0]!.person;
            return (
              <Link key={personId} href={`/logistics/people?person=${personId}`} className="tz-row">
                <span className="tz-row-body items-start">
                  <span className="tz-row-title">
                    <span className="font-medium">{p?.name ?? "—"}</span>
                    <span className="tz-row-sub text-xs">{[p?.companyName, p?.personalNumber].filter(Boolean).join(" · ")}</span>
                    {list.map((r) => (
                      <span key={r.id} className="block text-[13px] text-ink-muted">
                        {r.itemName} {r.serial ? <Serial>{r.serial}</Serial> : "(ללא צ׳)"} · מ-{fmtDate(r.storedAt)}
                      </span>
                    ))}
                  </span>
                  <span className="tz-chip tz-chip-brigade">{list.length}</span>
                </span>
              </Link>
            );
          })}
        </Panel>
      </div>
    </>
  );
}
