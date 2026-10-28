import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { byHe, expandKit, matches } from "@gdud/core";
import { withUser } from "@gdud/db";
import { Icon, Serial } from "@gdud/ui";
import { Empty, PageHeader, SmallTile } from "@/components/page-parts";
import { kesherAccess } from "@/lib/kesher/access";
import { companyStatus, groupBy, loadKesher, loadLastChecks, loadLastSeen, loadMissing, loadVehicles, placeTotal, stockKey, vehicleLabel } from "@/lib/kesher/data";
import { loadPeople, personPlace } from "@/lib/logistics/data";
import { fmtCount, fmtWhen } from "@/lib/logistics/format";
import { requireModule } from "@/lib/session";
import { CompanyDot, ReportChip, SearchBox, SeenChip, SegLinks, SoldierName, pillCount } from "../../_components/ui";
import type { SheetPerson } from "../../_components/serial-sheet";
import { AssignProvider, GroupCheck, RowCheck, RowEdit } from "./_components/assign";

export const metadata = { title: "פלוגה" };

const paramsSchema = z.object({ unit: z.uuid() });
const searchSchema = z.object({
  tab: z.enum(["serials", "comp"]).catch("serials"),
  q: z.string().trim().max(80).optional().catch(undefined),
});

/**
 * פלוגה (mockup #/companies/<unit>): the company's צ׳ grouped by device type with who holds each
 * inside the company, and its ציוד משלים against the תקן. Anyone covering the company edits the
 * שיוך בתוך הפלוגה (soldier · תפקיד · מסגרת) and files a דוח צ׳ (/kesher/check); a battalion admin
 * also edits חותם על הפלוגה.
 */
export default async function KesherCompany({
  params,
  searchParams,
}: {
  params: Promise<{ unit: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const s = await requireModule("kesher");
  const access = kesherAccess(s);
  const p = paramsSchema.safeParse(await params);
  const company = p.success ? access.companies.find((c) => c.id === p.data.unit) : undefined;
  if (!company) notFound();
  const f = searchSchema.parse(await searchParams);
  const now = new Date();

  const { data, last, lastSeen, missing, soldiers, vehicles } = await withUser(s.claims, async (tx) => {
    const [data, lastChecks, lastSeen, soldiers, vehicles] = await Promise.all([
      loadKesher(tx, s.units),
      loadLastChecks(tx),
      loadLastSeen(tx),
      loadPeople(tx, s.units),
      access.isAdmin ? loadVehicles(tx) : Promise.resolve([]),
    ]);
    const last = lastChecks.get(company.id);
    const missing = last && last.found < last.total ? await loadMissing(tx, last.id) : [];
    return { data, last, lastSeen, missing, soldiers, vehicles };
  });

  const counts = groupBy(
    data.serials.filter((x) => x.location === "company"),
    (x) => x.unitId,
  );
  const mine = counts.get(company.id) ?? [];
  const assigned = mine.filter((x) => x.holder?.holder).length;
  const status = companyStatus(last, data.staleDays, now);
  const base = `/kesher/companies/${company.id}`;
  // the picker: active soldiers (RLS already limits people to what the user covers); an admin may
  // move a צ׳ to another company, so gets every company's
  const people: SheetPerson[] = soldiers
    .filter((p) => access.isAdmin || p.companyId === company.id)
    .map((p) => ({ id: p.id, name: p.name, personalNumber: p.personalNumber, place: personPlace(p), platoonName: p.platoonName, companyId: p.companyId }));

  return (
    <>
      <nav className="tz-pills" aria-label="פלוגות">
        {access.companies.map((c) => (
          <Link key={c.id} href={`/kesher/companies/${c.id}${f.tab === "comp" ? "?tab=comp" : ""}`} className="tz-pill" aria-current={c.id === company.id ? "page" : undefined}>
            <CompanyDot color={c.color} />
            {c.name} {pillCount(counts.get(c.id)?.length ?? 0)}
          </Link>
        ))}
      </nav>
      <PageHeader
        title={company.name}
        sub={`${fmtCount(mine.length)} צ׳ · ${fmtCount(assigned)} משויכים לחותם בתוך הפלוגה · ${fmtCount(placeTotal(data, company.id))} פריטי ציוד משלים`}
        actions={
          <>
            {access.isAdmin ? (
              <>
                <Link href={`/kesher/sign?unit=${company.id}`} className="tz-btn tz-btn-filled tz-btn-sm">
                  <Icon name="pencil" size={16} />
                  החתמה לפלוגה
                </Link>
                <Link href={`/kesher/credit?unit=${company.id}`} className="tz-btn tz-btn-tinted tz-btn-sm">
                  <Icon name="undo" size={16} />
                  זיכוי
                </Link>
              </>
            ) : null}
            <Link href={`/kesher/reports/print?r=company&unit=${company.id}`} className="tz-btn tz-btn-tinted tz-btn-sm">
              <Icon name="print" size={16} />
              רשימת ציוד להדפסה
            </Link>
          </>
        }
      />

      <div className="tz-card flex flex-wrap items-center gap-3 px-4 py-3.5">
        <SmallTile color={status.kind === "ok" ? "var(--tile-ok)" : "var(--tile-document)"} icon="report" />
        <span className="flex min-w-[200px] flex-1 flex-col">
          <span className="flex items-center gap-2">
            <span className="font-semibold">דוח צ׳ אחרון</span>
            <ReportChip status={status} />
          </span>
          <span className="text-[13px] text-ink-muted">
            {last ? (
              <>
                {fmtWhen(last.at, now)}
                {last.reporterName ? ` · ${last.reporterName}` : ""} · {last.found}/{last.total} נראו בעין
                {missing.length ? (
                  <>
                    {" "}
                    · לא נמצאו:{" "}
                    {missing.map((m, i) => (
                      <span key={m.serial}>
                        {i ? ", " : ""}
                        <Serial>{m.serial}</Serial>
                      </span>
                    ))}
                  </>
                ) : null}
              </>
            ) : (
              "עדיין לא הוגש דוח צ׳ לפלוגה"
            )}
          </span>
        </span>
        {mine.length ? (
          <Link href={`/kesher/check?unit=${company.id}`} className="tz-btn tz-btn-filled tz-btn-sm">
            <Icon name="check" size={16} />
            דוח צ׳ חדש
          </Link>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SegLinks
          label="תצוגה"
          items={[
            { href: base, label: `צ׳ (${fmtCount(mine.length)})`, on: f.tab === "serials" },
            { href: `${base}?tab=comp`, label: "ציוד משלים", on: f.tab === "comp" },
          ]}
        />
        {f.tab === "serials" ? <SearchBox action={base} q={f.q} placeholder="סינון לפי צ׳, מכשיר או חותם" /> : null}
      </div>

      {f.tab === "comp" ? (
        <CompTable data={data} unitId={company.id} serials={mine} />
      ) : (
        <AssignProvider
          isAdmin={access.isAdmin}
          vehicles={vehicles.map((v) => ({ number: v.number, label: vehicleLabel(v) }))}
          people={people}
          companies={access.companies.map((c) => ({ id: c.id, name: c.name }))}
          rows={mine.map((x) => ({
            serialId: x.id,
            serial: x.serial,
            item: x.itemName,
            location: x.location,
            unitId: x.unitId,
            vehicle: x.vehicle,
            notes: x.notes,
            holderPersonId: x.holder?.holder?.id ?? null,
            holderRole: x.holder?.holderRole ?? null,
            frame: x.holder?.frame ?? null,
            signerPersonId: x.holder?.signer?.id ?? null,
            signerRole: x.holder?.signerRole ?? null,
          }))}
        >
          <SerialsTable
            rows={mine.filter((x) => !f.q || matches(f.q, x.serial, x.itemName, x.holder?.holder?.name, x.holder?.signer?.name, x.holder?.holderRole, x.holder?.frame))}
            unitId={company.id}
            companyName={company.name}
            lastSeen={lastSeen}
            ages={{ warnDays: data.warnDays, alertDays: data.alertDays }}
            now={now}
          />
        </AssignProvider>
      )}
    </>
  );
}

function SerialsTable({
  rows,
  unitId,
  companyName,
  lastSeen,
  ages,
  now,
}: {
  rows: Awaited<ReturnType<typeof loadKesher>>["serials"];
  unitId: string;
  companyName: string;
  lastSeen: Awaited<ReturnType<typeof loadLastSeen>>;
  ages: { warnDays: number; alertDays: number };
  now: Date;
}) {
  const groups = [...groupBy(rows, (x) => x.itemName)].sort(([a], [b]) => byHe(a, b));
  return (
    <>
      <div className="tz-table-wrap">
        {rows.length ? (
          <table className="tz-table">
            <thead>
              <tr>
                <th className="w-0">
                  <span className="sr-only">בחירה</span>
                </th>
                <th>צ׳</th>
                <th>חתום</th>
                <th>תפקיד</th>
                <th>מסגרת</th>
                <th className="max-md:hidden">חותם על הפלוגה</th>
                <th className="max-md:hidden">האמר</th>
                <th>נבדק</th>
                <th className="w-0">
                  <span className="sr-only">עריכה</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([type, list]) => (
                <GroupRows key={type} type={type} list={list} unitId={unitId} lastSeen={lastSeen} ages={ages} now={now} />
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>אין צ׳ תואם</Empty>
        )}
      </div>
      <p className="tz-section-footer">השיוך בתוך הפלוגה (חותם · תפקיד · מסגרת) לא משנה את הפלוגה החתומה — הצ׳ נשאר על {companyName}. רק מנהל קשר גדודי משנה מיקום, חותם על הפלוגה, האמר והערה.</p>
    </>
  );
}

function GroupRows({
  type,
  list,
  unitId,
  lastSeen,
  ages,
  now,
}: {
  type: string;
  list: Awaited<ReturnType<typeof loadKesher>>["serials"];
  unitId: string;
  lastSeen: Awaited<ReturnType<typeof loadLastSeen>>;
  ages: { warnDays: number; alertDays: number };
  now: Date;
}) {
  const done = list.filter((x) => x.holder?.holder).length;
  return (
    <>
      <tr className="tz-group-row">
        <th>
          <GroupCheck ids={list.map((x) => x.id)} label={type} />
        </th>
        <th colSpan={8}>
          {type}{" "}
          <span className="tz-num font-normal">
            · {done}/{list.length} משויכים
          </span>
        </th>
      </tr>
      {list.map((x) => (
        <tr key={x.id}>
          <td>
            <RowCheck id={x.id} label={`${type} ${x.serial}`} />
          </td>
          <th scope="row">
            <Link href={`/kesher/serials?sel=${x.id}`} className="no-underline">
              <Serial>{x.serial}</Serial>
            </Link>
          </th>
          <td>
            <SoldierName person={x.holder?.holder ?? null} unitId={unitId} />
          </td>
          <td>{x.holder?.holderRole ?? ""}</td>
          <td>{x.holder?.frame ?? ""}</td>
          <td className="max-md:hidden">
            {x.holder?.signer ? (
              <>
                <SoldierName person={x.holder.signer} unitId={unitId} />
                {x.holder.signerRole ? <span className="tz-row-sub text-xs">{x.holder.signerRole}</span> : null}
              </>
            ) : (
              <span className="text-xs text-ink-muted" data-sort="">
                ללא חותם
              </span>
            )}
          </td>
          <td className="max-md:hidden">{x.vehicle ? <Serial>{x.vehicle}</Serial> : null}</td>
          <td>
            <SeenChip seen={lastSeen.get(x.id)} {...ages} now={now} />
          </td>
          <td className="py-0">
            <RowEdit id={x.id} label={`${type} ${x.serial}`} />
          </td>
        </tr>
      ))}
    </>
  );
}

/** חתומים / לפי תקן / פער per ציוד משלים item. */
function CompTable({ data, unitId, serials }: { data: Awaited<ReturnType<typeof loadKesher>>; unitId: string; serials: { itemName: string }[] }) {
  const counts = new Map<string, number>();
  for (const x of serials) counts.set(x.itemName, (counts.get(x.itemName) ?? 0) + 1);
  const std = expandKit(counts, data.kits);
  const rows = data.items.filter((i) => i.kind === "bulk" && ((data.stock.get(stockKey(i.id, unitId)) ?? 0) || std.get(i.name)));
  return (
    <>
      <div className="tz-table-wrap">
        {rows.length ? (
          <table className="tz-table">
            <thead>
              <tr>
                <th>פריט</th>
                <th>קטגוריה</th>
                <th>חתומים</th>
                <th>לפי תקן</th>
                <th>פער</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => {
                const have = data.stock.get(stockKey(i.id, unitId)) ?? 0;
                const want = std.get(i.name) ?? 0;
                const d = have - want;
                return (
                  <tr key={i.id}>
                    <th scope="row">{i.name}</th>
                    <td className="text-ink-muted">{i.category ?? ""}</td>
                    <td className="tz-num font-semibold">{fmtCount(have)}</td>
                    <td className={`tz-num ${want ? "" : "tz-zero"}`}>{fmtCount(want)}</td>
                    <td className="tz-num">{d === 0 ? <span className="tz-zero">—</span> : d < 0 ? <span className="font-semibold text-danger">{d}</span> : `+${d}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty>אין ציוד משלים על הפלוגה</Empty>
        )}
      </div>
      <p className="tz-section-footer">&quot;לפי תקן&quot; מחושב מהצ׳ שעל הפלוגה ומטבלת תקן הציוד המשלים. פער שלילי = הפלוגה חתומה על פחות מהתקן.</p>
    </>
  );
}
