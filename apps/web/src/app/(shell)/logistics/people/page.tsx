import Link from "next/link";
import { z } from "zod";
import { byHe, matches } from "@gdud/core";
import { withUser } from "@gdud/db";
import { Avatar, Icon, Serial } from "@gdud/ui";
import { logisticsAccess } from "@/lib/logistics/access";
import { companiesOf, groupBy, loadHoldings, loadPeople, loadStorage, type HoldingVM, type PersonVM } from "@/lib/logistics/data";
import { fmtCount } from "@/lib/logistics/format";
import { requireModule } from "@/lib/session";
import { ClickableRow } from "../_components/clickable-row";
import { Empty, PageHeader, withParams } from "../_components/ui";
import { PersonInspector } from "./person-inspector";

export const metadata = { title: "פלוגות ואלפון" };

const paramsSchema = z.object({
  unit: z.union([z.uuid(), z.literal("all"), z.literal("none")]).optional().catch(undefined),
  q: z.string().max(80).optional().catch(undefined),
  person: z.uuid().optional().catch(undefined),
  inactive: z.literal("1").optional().catch(undefined),
  /** only soldiers with nothing signed on them */
  empty: z.literal("1").optional().catch(undefined),
});

export default async function PeoplePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requireModule("logistics");
  const access = logisticsAccess(s);
  const sp = paramsSchema.parse(await searchParams);

  const { people, holdings, stored } = await withUser(s.claims, async (tx) => ({
    people: await loadPeople(tx, s.units, { includeInactive: true }),
    holdings: await loadHoldings(tx),
    stored: await loadStorage(tx),
  }));

  const holdingsBy = groupBy(holdings, (h) => h.personId);
  const storedBy = groupBy(stored, (x) => x.personId);
  const companies = companiesOf(s.units).filter((c) => people.some((p) => p.companyId === c.id));
  const selectedPerson = sp.person ? people.find((p) => p.id === sp.person) : undefined;
  // default tab: the selected soldier's company, else the first company the user can see
  const unit = sp.unit ?? selectedPerson?.companyId ?? companies[0]?.id ?? "all";
  const current = { unit, q: sp.q, person: sp.person, inactive: sp.inactive, empty: sp.empty };

  const inScope = (p: PersonVM) => (unit === "all" ? true : unit === "none" ? !p.companyId : p.companyId === unit);
  const visible = (p: PersonVM) => p.active || (sp.inactive === "1" && (holdingsBy.get(p.id)?.length ?? 0) > 0);
  const serialHits = (p: PersonVM): HoldingVM[] =>
    sp.q ? (holdingsBy.get(p.id) ?? []).filter((h) => matches(sp.q!, h.serial, h.itemName)) : [];
  const holdsNothing = (p: PersonVM) => !holdingsBy.get(p.id)?.length;
  const emptyCount = people.filter((p) => inScope(p) && p.active && holdsNothing(p)).length;
  const list = people
    .filter((p) => inScope(p) && visible(p))
    .filter((p) => !sp.empty || holdsNothing(p))
    .filter((p) => !sp.q || matches(sp.q, p.name, p.personalNumber, p.phone) || serialHits(p).length > 0);

  const groupKey = (p: PersonVM) => (unit === "all" ? (p.companyName ?? "ללא פלוגה") : (p.platoonName ?? "ללא מחלקה"));
  const groups = [...groupBy(list, groupKey).entries()].sort(([a], [b]) => byHe(a, b));
  const emptyHref = withParams("/logistics/people", current, { empty: sp.empty ? null : "1", person: null });
  const unitName = unit === "all" ? "כל הגדוד" : unit === "none" ? "ללא פלוגה" : (companies.find((c) => c.id === unit)?.name ?? "פלוגה");
  const totalItems = list.reduce((n, p) => n + (holdingsBy.get(p.id)?.length ?? 0), 0);
  const addUnit = unit !== "all" && unit !== "none" ? unit : undefined;

  return (
    <>
      <PageHeader
        title={unitName}
        sub={sp.empty ? `${fmtCount(list.length)} חיילים בלי ציוד חתום` : `${fmtCount(list.length)} חיילים · ${fmtCount(totalItems)} פריטים מוחתמים`}
        actions={
          <>
            <form className="tz-search min-w-[220px] bg-surface" role="search">
              <input type="hidden" name="unit" value={unit} />
              {sp.inactive ? <input type="hidden" name="inactive" value="1" /> : null}
              {sp.empty ? <input type="hidden" name="empty" value="1" /> : null}
              <Icon name="search" size={15} />
              <input type="search" name="q" defaultValue={sp.q} placeholder={`חיפוש ב${unitName}: שם, מ.א, צ׳ או פריט`} aria-label="חיפוש בפלוגה" />
            </form>
            <Link href={emptyHref} aria-pressed={!!sp.empty} className={`tz-btn tz-btn-sm ${sp.empty ? "tz-btn-filled" : "tz-btn-tinted"}`}>
              בלי ציוד חתום
              <span className="tz-num">{fmtCount(emptyCount)}</span>
            </Link>
            <Link href={withParams("/logistics/summary", {}, { unit: addUnit })} className="tz-btn tz-btn-tinted tz-btn-sm">
              סיכום אמצעים
            </Link>
            {access.isAdmin ? (
              <Link href={withParams("/logistics/people/new", {}, { unit: addUnit })} className="tz-btn tz-btn-filled tz-btn-sm">
                <Icon name="plus" size={16} />
                חייל חדש
              </Link>
            ) : null}
          </>
        }
      />

      <nav className="tz-pills" aria-label="בחירת פלוגה">
        {companies.map((c) => (
          <Link key={c.id} aria-current={(unit === c.id) ? "page" : undefined} className="tz-pill" href={withParams("/logistics/people", current, { unit: c.id, person: null })}>
            {c.name}
          </Link>
        ))}
        {people.some((p) => !p.companyId) ? (
          <Link aria-current={(unit === "none") ? "page" : undefined} className="tz-pill" href={withParams("/logistics/people", current, { unit: "none", person: null })}>
            ללא פלוגה
          </Link>
        ) : null}
        <Link aria-current={(unit === "all") ? "page" : undefined} className="tz-pill" href={withParams("/logistics/people", current, { unit: "all", person: null })}>
          כל הגדוד
        </Link>
      </nav>

      <div className="grid items-start gap-[22px] lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="tz-table-wrap order-2 lg:order-1">
          {groups.length ? (
            <table className="tz-table">
              <thead>
                <tr>
                  <th scope="col">שם</th>
                  <th scope="col">מספר אישי</th>
                  <th scope="col" className="max-sm:hidden">
                    טלפון
                  </th>
                  <th scope="col">פריטים</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(([name, members]) => {
                  const items = members.reduce((n, p) => n + (holdingsBy.get(p.id)?.length ?? 0), 0);
                  return (
                    <RosterGroup key={name} title={`${name} · ${members.length} חיילים · ${fmtCount(items)} פריטים`}>
                      {members.map((p) => {
                        const href = withParams("/logistics/people", current, { person: p.id });
                        const n = holdingsBy.get(p.id)?.length ?? 0;
                        const st = storedBy.get(p.id)?.length ?? 0;
                        return (
                          <ClickableRow key={p.id} href={href} selected={p.id === sp.person}>
                            <td>
                              <Link href={href} scroll={false} className="tz-cell-link">
                                <span className="flex items-center gap-2.5">
                                  <Avatar name={p.name} size={28} />
                                  <span className="flex flex-col">
                                    <span>
                                      {p.name}
                                      {!p.active ? <span className="tz-chip tz-chip-broken ms-2">הוסר</span> : null}
                                    </span>
                                    {serialHits(p).map((h) => (
                                      <span key={h.id} className="text-xs text-ink-muted">
                                        {h.itemName} <Serial>{h.serial}</Serial>
                                      </span>
                                    ))}
                                  </span>
                                </span>
                              </Link>
                            </td>
                            <td dir="ltr" className="tz-serial text-end">
                              {p.personalNumber ?? ""}
                            </td>
                            <td dir="ltr" className="tz-serial text-end max-sm:hidden">
                              {p.phone ?? ""}
                            </td>
                            <td className="tz-num">
                              {n ? fmtCount(n) : <span className="text-ink-muted">אין</span>}
                              {st ? <span className="tz-chip tz-chip-brigade ms-2">{st} באפסון</span> : null}
                            </td>
                          </ClickableRow>
                        );
                      })}
                    </RosterGroup>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <Empty>{sp.q ? "אין תוצאות" : sp.empty ? "לכל החיילים במסגרת הזו יש ציוד חתום" : "אין חיילים במסגרת הזו"}</Empty>
          )}
        </div>

        {selectedPerson ? (
          <PersonInspector
            person={selectedPerson}
            holdings={holdingsBy.get(selectedPerson.id) ?? []}
            stored={storedBy.get(selectedPerson.id) ?? []}
            canAdmin={access.canAdminUnit(selectedPerson.unitId)}
            canEdit={access.canEditPeople(selectedPerson.unitId)}
            closeHref={withParams("/logistics/people", current, { person: null })}
          />
        ) : (
          <aside className="tz-card order-1 hidden p-6 text-center text-[14px] text-ink-muted lg:order-2 lg:block">בחרו חייל כדי לראות את הכרטיס שלו</aside>
        )}
      </div>
    </>
  );
}

function RosterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <tr className="tz-group-row">
        <th colSpan={4} scope="colgroup">
          {title}
        </th>
      </tr>
      {children}
    </>
  );
}

