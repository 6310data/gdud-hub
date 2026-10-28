import Link from "next/link";
import type { ReactNode } from "react";
import { z } from "zod";
import { KESHER_EVENT_LABEL, checkAge, matches } from "@gdud/core";
import { desc, eq, schema, withUser, type Tx } from "@gdud/db";
import { Icon, Serial } from "@gdud/ui";
import { Empty, PageHeader, Panel, SmallTile, withParams } from "@/components/page-parts";
import { kesherAccess } from "@/lib/kesher/access";
import { leftCompany, loadKesher, loadLastEye, loadLastSeen, type EyeCheck, type KSerial, type LastSeen, loadVehicles, vehicleLabel } from "@/lib/kesher/data";
import { companiesOf, loadPeople, personPlace } from "@/lib/logistics/data";
import { fmtCount, fmtDate, fmtWhen } from "@/lib/logistics/format";
import { requireModule } from "@/lib/session";
import { distinct } from "@/lib/kesher/suggestions";
import type { SheetPerson } from "../_components/serial-sheet";
import { AgeChip, LocationChip, SearchBox, SeenChip, companyRefs, pillCount, type CompanyRef } from "../_components/ui";
import { SerialEdit } from "./_components/serial-edit";

export const metadata = { title: "צ׳ במערכת" };

const SHOWN = 500;
const FILTERS = ["", "wh", "co", "none", "miss", "noeye", "left", "nosigner", "returned"] as const;
type Filter = (typeof FILTERS)[number];
const searchSchema = z.object({
  q: z.string().trim().max(80).optional().catch(undefined),
  f: z.enum(FILTERS).catch(""),
  sel: z.uuid().optional().catch(undefined),
});

const FILTER_LABEL: Record<Filter, string> = {
  "": "הכל",
  wh: "במחסן",
  co: "בפלוגות",
  none: "ללא שיוך",
  miss: "לא נמצאו בדוח",
  noeye: "לא נבדקו בעין",
  left: "חותם שעבר / הוסר",
  nosigner: "בלי חותם",
  returned: "הוחזרו לחטיבה",
};

/** What a row is filtered by besides the צ׳ itself. */
interface Checks {
  seen: LastSeen | undefined;
  eye: EyeCheck | undefined;
  now: Date;
  warnDays: number;
  alertDays: number;
}

function keep(x: KSerial, f: Filter, { seen, eye, now, warnDays, alertDays }: Checks): boolean {
  // the צ׳ returned to the brigade show under their own pill only
  if ((f === "returned") !== (x.location === "brigade")) return false;
  switch (f) {
    case "wh":
      return x.location === "warehouse";
    case "co":
      return x.location === "company";
    case "none":
      return x.location === "none";
    case "miss":
      return x.location === "company" && seen?.found === false;
    case "left":
      return Boolean(x.holder && (leftCompany(x.holder.holder, x.holder.unitId) || leftCompany(x.holder.signer, x.holder.unitId)));
    case "nosigner":
      return Boolean(x.holder && !x.holder.signer);
    case "noeye":
      return ["none", "alert"].includes(checkAge(eye?.at, now, warnDays, alertDays).tone);
    default:
      return true;
  }
}

/**
 * צ׳ במערכת (mockup #/serials): every צ׳ with its place; holders only for the companies the user
 * covers (RLS). Replaces both חיפוש צ׳ and ניהול צ׳: the inspector's עריכה opens the company page's
 * sheet — a battalion admin edits every field, a company user the holder inside their company.
 */
export default async function KesherSerials({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requireModule("kesher");
  const f = searchSchema.parse(await searchParams);
  const now = new Date();
  const companies = companyRefs(companiesOf(s.units));

  const access = kesherAccess(s);
  const { data, lastSeen, lastEye, history, soldiers, vehicles } = await withUser(s.claims, async (tx) => {
    // with the צ׳ returned to the brigade (their own pill); every other view leaves them out
    const [data, lastSeen, lastEye] = await Promise.all([loadKesher(tx, s.units, { returned: true }), loadLastSeen(tx), loadLastEye(tx)]);
    const sel = f.sel ? data.serials.find((x) => x.id === f.sel) : undefined;
    // a צ׳ returned to the brigade is history only (it comes back through the brigade screen)
    const editable = sel && sel.location !== "brigade" && (access.isAdmin || (sel.location === "company" && access.covers(sel.unitId)));
    const [history, soldiers, vehicles] = await Promise.all([
      sel ? loadHistory(tx, sel.id, sel.serial) : [],
      editable ? loadPeople(tx, s.units) : null,
      editable && access.isAdmin ? loadVehicles(tx) : [],
    ]);
    return { data, lastSeen, lastEye, history, soldiers, vehicles };
  });

  const checks = (x: KSerial): Checks => ({ seen: lastSeen.get(x.id), eye: lastEye.get(x.id), now, warnDays: data.warnDays, alertDays: data.alertDays });
  const counts = Object.fromEntries(FILTERS.map((k) => [k, data.serials.filter((x) => keep(x, k, checks(x))).length])) as Record<Filter, number>;
  const inSystem = data.serials.filter((x) => x.location !== "brigade");
  const rows = data.serials.filter(
    (x) =>
      keep(x, f.f, checks(x)) &&
      (!f.q || matches(f.q, x.serial, x.itemName, companies.get(x.unitId ?? "")?.name, x.holder?.holder?.name, x.holder?.signer?.name, x.holder?.frame, x.holder?.holderRole)),
  );
  const shown = rows.slice(0, SHOWN);
  const sel = f.sel ? data.serials.find((x) => x.id === f.sel) : undefined;
  const current = { q: f.q, f: f.f || undefined };
  const types = new Set(inSystem.map((x) => x.itemId)).size;

  return (
    <>
      <PageHeader title="צ׳ במערכת" sub={`${fmtCount(inSystem.length)} צ׳ · ${types} סוגי מכשירים`} />
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox action="/kesher/serials" q={f.q} placeholder="צ׳, מכשיר, חותם או מסגרת" keep={{ f: f.f || undefined }} />
        <nav className="tz-pills" aria-label="סינון">
          {FILTERS.filter((k) => k === "" || counts[k] || k === f.f || ["wh", "co", "none", "miss", "noeye"].includes(k)).map((k) => (
            <Link key={k} href={withParams("/kesher/serials", current, { f: k || null, sel: null })} className="tz-pill" aria-current={f.f === k ? "page" : undefined}>
              {FILTER_LABEL[k]} {pillCount(counts[k])}
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid items-start gap-[22px] lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="tz-table-wrap">
          {rows.length ? (
            <>
              <table className="tz-table">
                <thead>
                  <tr>
                    <th>צ׳</th>
                    <th>מכשיר</th>
                    <th>מיקום</th>
                    <th>חותם</th>
                    <th className="max-md:hidden">תפקיד · מסגרת</th>
                    <th className="max-md:hidden">נבדק בפלוגה</th>
                    <th className="max-md:hidden">צהוב בעיניים</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((x) => (
                    <tr key={x.id} className="tz-hover" data-selected={x.id === f.sel ? "" : undefined}>
                      <th scope="row">
                        <Link href={withParams("/kesher/serials", current, { sel: x.id })} scroll={false} className="no-underline">
                          <Serial>{x.serial}</Serial>
                        </Link>
                      </th>
                      <td>{x.itemName}</td>
                      <td>
                        <LocationChip serial={x} company={companies.get(x.unitId ?? "")} />
                      </td>
                      <td>{x.holder?.holder?.name ?? <span className="tz-zero">—</span>}</td>
                      <td className="text-ink-muted max-md:hidden">{[x.holder?.holderRole, x.holder?.frame].filter(Boolean).join(" · ")}</td>
                      <td className="max-md:hidden">
                        {x.location === "company" ? <SeenChip seen={lastSeen.get(x.id)} warnDays={data.warnDays} alertDays={data.alertDays} now={now} /> : null}
                      </td>
                      <td className="max-md:hidden">
                        {x.location === "brigade" ? null : (
                          <AgeChip at={lastEye.get(x.id)?.at} by={lastEye.get(x.id)?.byName} warnDays={data.warnDays} alertDays={data.alertDays} now={now} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > shown.length ? (
                <div className="tz-footnote px-4 py-2.5">
                  מוצגים {shown.length} מתוך {fmtCount(rows.length)} — צמצמו את החיפוש
                </div>
              ) : null}
            </>
          ) : (
            <Empty>לא נמצא צ׳ תואם</Empty>
          )}
        </div>
        {sel ? (
          <Inspector
            edit={
              soldiers ? (
                <SerialEdit
                  isAdmin={access.isAdmin}
                  vehicles={vehicles.map((v) => ({ number: v.number, label: vehicleLabel(v) }))}
                  companies={access.companies.map((c) => ({ id: c.id, name: c.name }))}
                  people={soldiers
                    .filter((p) => access.isAdmin || p.companyId === sel.unitId)
                    .map((p): SheetPerson => ({ id: p.id, name: p.name, personalNumber: p.personalNumber, place: personPlace(p), platoonName: p.platoonName, companyId: p.companyId }))}
                  suggestions={{
                    role: distinct(data.serials.map((x) => x.holder?.holderRole ?? null)),
                    frame: distinct(data.serials.filter((x) => x.unitId === sel.unitId).map((x) => x.holder?.frame ?? null)),
                    signerRole: distinct(data.serials.map((x) => x.holder?.signerRole ?? null)),
                  }}
                  row={{
                    serialId: sel.id,
                    serial: sel.serial,
                    item: sel.itemName,
                    location: sel.location,
                    unitId: sel.unitId,
                    vehicle: sel.vehicle,
                    notes: sel.notes,
                    holderPersonId: sel.holder?.holder?.id ?? null,
                    holderRole: sel.holder?.holderRole ?? null,
                    frame: sel.holder?.frame ?? null,
                    signerPersonId: sel.holder?.signer?.id ?? null,
                    signerRole: sel.holder?.signerRole ?? null,
                  }}
                />
              ) : null
            }
            x={sel}
            company={companies.get(sel.unitId ?? "")}
            seen={lastSeen.get(sel.id)}
            eye={lastEye.get(sel.id)}
            warnDays={data.warnDays}
            alertDays={data.alertDays}
            history={history}
            closeHref={withParams("/kesher/serials", current, {})}
            now={now}
          />
        ) : (
          <aside className="tz-card p-6 text-center text-[14px] text-ink-muted max-md:hidden">בחרו צ׳ כדי לראות איפה הוא, מי חתום עליו ומה קרה איתו</aside>
        )}
      </div>
    </>
  );
}

interface HistoryItem {
  at: Date;
  title: string;
  sub: string;
}

/** The צ׳'s יומן rows and דוח צ׳ lines the user may see (RLS), newest first. */
async function loadHistory(tx: Tx, serialId: string, serial: string): Promise<HistoryItem[]> {
  const e = schema.kesherEvents;
  const [evs, checks] = await Promise.all([
    tx.select().from(e).where(eq(e.serial, serial)).orderBy(desc(e.at)).limit(50),
    tx
      .select({ at: schema.kesherChecks.at, found: schema.kesherCheckLines.found, by: schema.kesherChecks.reporterName })
      .from(schema.kesherCheckLines)
      .innerJoin(schema.kesherChecks, eq(schema.kesherChecks.id, schema.kesherCheckLines.checkId))
      .where(eq(schema.kesherCheckLines.serialId, serialId))
      .orderBy(desc(schema.kesherChecks.at))
      .limit(20),
  ]);
  return [
    ...evs.map((r) => ({
      at: r.at,
      title: [r.kind === "legacy" && r.details ? r.details : KESHER_EVENT_LABEL[r.kind], r.company].filter(Boolean).join(" · "),
      sub: [r.kind === "assign" || r.kind === "serial_edit" ? r.details : r.personName, r.sheetActor ?? r.actorName ? `ע״י ${r.sheetActor ?? r.actorName}` : null].filter(Boolean).join(" · "),
    })),
    ...checks.map((c) => ({ at: c.at, title: c.found ? "נראה בעין בדוח צ׳" : "לא נמצא בדוח צ׳", sub: c.by ?? "" })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
}

function Inspector({
  edit,
  x,
  company,
  seen,
  eye,
  warnDays,
  alertDays,
  history,
  closeHref,
  now,
}: {
  /** the עריכה button, when the user may edit this צ׳ */
  edit: ReactNode;
  x: KSerial;
  company?: CompanyRef;
  seen: LastSeen | undefined;
  eye: EyeCheck | undefined;
  warnDays: number;
  alertDays: number;
  history: HistoryItem[];
  closeHref: string;
  now: Date;
}) {
  const rows: [string, ReactNode][] = [
    ["מיקום", <LocationChip key="l" serial={x} company={company} />],
    ["חותם על הפלוגה", x.holder?.signer ? [x.holder.signer.name, x.holder.signerRole].filter(Boolean).join(" · ") : "—"],
    ["חותם בפלוגה", x.holder?.holder?.name ?? "—"],
    ["תפקיד", x.holder?.holderRole ?? "—"],
    ["מסגרת", x.holder?.frame ?? "—"],
    ["האמר", x.vehicle ? <Serial key="v">{x.vehicle}</Serial> : "—"],
    ["הערה", x.notes ?? "—"],
    [
      "נבדק בפלוגה",
      x.location === "company" ? <SeenChip key="s" seen={seen} warnDays={warnDays} alertDays={alertDays} now={now} /> : <span className="text-ink-muted">{x.location === "warehouse" ? "במחסן" : "—"}</span>,
    ],
    [
      "צהוב בעיניים",
      x.location === "brigade" ? (
        <span className="text-ink-muted">—</span>
      ) : (
        <span key="e" className="inline-flex flex-wrap items-center gap-1.5">
          <AgeChip at={eye?.at} by={eye?.byName} warnDays={warnDays} alertDays={alertDays} now={now} />
          {eye ? <span className="text-xs text-ink-muted">{[fmtDate(eye.at), eye.byName].filter(Boolean).join(" · ")}</span> : null}
        </span>
      ),
    ],
  ];
  return (
    <aside className="flex flex-col gap-3 lg:sticky lg:top-6" aria-label={`צ׳ ${x.serial}`}>
      <div className="tz-card flex flex-col gap-3 p-4">
        <div className="flex items-center gap-3">
          <SmallTile color="var(--primary)" icon="antenna" size={36} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="tz-headline">{x.itemName}</span>
            <span className="text-[17px]">
              <Serial>{x.serial}</Serial>
            </span>
          </span>
          {edit}
          <Link href={closeHref} scroll={false} className="tz-icon-btn" aria-label="סגירה">
            <Icon name="close" size={18} />
          </Link>
        </div>
        <div className="tz-group bg-ground">
          {rows.map(([k, v]) => (
            <div key={k} className="tz-row bg-transparent">
              <span className="tz-row-body min-h-[40px] py-1.5">
                <span className="tz-row-title text-[13px] text-ink-muted">{k}</span>
                <span className="text-[14px]">{v}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
      <Panel title="היסטוריה">
        {history.length ? (
          <ul className="m-0 list-none p-0">
            {history.map((h, i) => (
              <li key={i} className="flex gap-2.5 border-b border-separator px-4 py-2.5 text-[14px] last:border-0">
                <span aria-hidden="true" className="mt-[7px] size-2 flex-none rounded-full bg-primary" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span>{h.title}</span>
                  <span className="text-xs text-ink-muted">{[fmtWhen(h.at, now), h.sub].filter(Boolean).join(" · ")}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>אין עדיין רישום על הצ׳ הזה</Empty>
        )}
      </Panel>
    </aside>
  );
}
