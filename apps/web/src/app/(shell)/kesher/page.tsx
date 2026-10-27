import Link from "next/link";
import type { ReactNode } from "react";
import { desc, schema, withUser } from "@gdud/db";
import { Icon } from "@gdud/ui";
import { Kpi, PageHeader, Panel, SmallTile } from "@/components/page-parts";
import { kesherAccess } from "@/lib/kesher/access";
import { companyStatus, groupBy, leftCompany, loadKesher, loadLastChecks, loadLastSeen, placeTotal, stockKey } from "@/lib/kesher/data";
import { companiesOf } from "@/lib/logistics/data";
import { fmtCount, fmtDate, fmtWhen } from "@/lib/logistics/format";
import { requireModule } from "@/lib/session";
import { EventsTable } from "./_components/events-table";
import { Meter, ReportChip } from "./_components/ui";

export const metadata = { title: "מחלקת קשר" };

const DAY_MS = 86_400_000;

/** סקירה (mockup #/home). Phase 1: read-only — the action buttons arrive with החתמה / זיכוי / דוח צ׳. */
export default async function KesherOverview() {
  const s = await requireModule("kesher");
  const access = kesherAccess(s);
  const now = new Date();

  const { data, lastChecks, lastSeen, events } = await withUser(s.claims, async (tx) => {
    const [data, lastChecks, lastSeen, events] = await Promise.all([
      loadKesher(tx, s.units),
      loadLastChecks(tx),
      loadLastSeen(tx),
      tx.select().from(schema.kesherEvents).orderBy(desc(schema.kesherEvents.at), desc(schema.kesherEvents.id)).limit(8),
    ]);
    return { data, lastChecks, lastSeen, events };
  });

  const companies = companiesOf(s.units);
  const byCompany = groupBy(
    data.serials.filter((x) => x.location === "company"),
    (x) => x.unitId,
  );
  const wh = data.serials.filter((x) => x.location === "warehouse").length;
  const none = data.serials.filter((x) => x.location === "none").length;
  const out = data.serials.length - wh - none;
  const seenRecently = data.serials.filter((x) => {
    const seen = lastSeen.get(x.id);
    return x.location === "company" && seen?.found && now.getTime() - seen.at.getTime() <= data.staleDays * DAY_MS;
  }).length;
  const assigned = (unitId: string) => (byCompany.get(unitId) ?? []).filter((x) => x.holder?.holder).length;
  const bulkCount = data.items.filter((i) => i.kind === "bulk").length;
  const pct = (n: number) => (data.serials.length ? Math.round((n / data.serials.length) * 100) : 0);

  // דורש טיפול: only what the user may see (holders and reports of their companies)
  const attention: { href: string; tile: ReactNode; title: string; sub: string }[] = [];
  if (none) attention.push({ href: "/kesher/serials?f=none", tile: <SmallTile color="var(--tile-broken)" icon="alert" size={28} />, title: `${fmtCount(none)} צ׳ ללא שיוך`, sub: "לא במחסן ולא על פלוגה — לשייך או לבדוק" });
  for (const c of access.companies) {
    const last = lastChecks.get(c.id);
    const st = companyStatus(last, data.staleDays, now);
    const count = byCompany.get(c.id)?.length ?? 0;
    const href = `/kesher/companies/${c.id}`;
    if (st.kind === "none" && count) attention.push({ href, tile: <SmallTile color="var(--tile-document)" icon="report" size={28} />, title: `${c.name} — לא הוגש דוח צ׳`, sub: `${fmtCount(count)} צ׳ על הפלוגה` });
    else if (st.kind === "missing")
      attention.push({ href, tile: <SmallTile color="var(--tile-document)" icon="alert" size={28} />, title: `${c.name} — ${st.missing} צ׳ לא נמצאו`, sub: `בדוח מ־${fmtWhen(last!.at, now)}${last!.reporterName ? ` · ${last!.reporterName}` : ""}` });
    else if (st.kind === "stale") attention.push({ href, tile: <SmallTile color="var(--tile-neutral)" icon="clock" size={28} />, title: `${c.name} — דוח צ׳ לפני ${st.days} ימים`, sub: "הגיע הזמן לבדיקה חוזרת" });
  }
  const held = data.serials.filter((x) => x.holder);
  const left = held.filter((x) => leftCompany(x.holder!.holder, x.holder!.unitId) || leftCompany(x.holder!.signer, x.holder!.unitId)).length;
  if (left) attention.push({ href: "/kesher/serials?f=left", tile: <SmallTile color="var(--tile-document)" icon="person" size={28} />, title: `${fmtCount(left)} צ׳ אצל חיילים שעברו פלוגה / הוסרו מהרשימה`, sub: "השיוך נשאר — יש לעדכן" });
  const noSigner = held.filter((x) => !x.holder!.signer).length;
  if (noSigner) attention.push({ href: "/kesher/serials?f=nosigner", tile: <SmallTile color="var(--tile-neutral)" icon="person" size={28} />, title: `${fmtCount(noSigner)} צ׳ על פלוגות בלי חותם`, sub: "יובאו מהגיליון בלי חייל מרשימת דוח 1" });

  const low = data.warehouseTracked
    ? data.items
        .filter((i) => i.kind === "bulk")
        .map((i) => ({ ...i, qty: data.stock.get(stockKey(i.id, null)) ?? 0 }))
        .filter((i) => i.qty <= 1)
        .sort((a, b) => a.qty - b.qty)
    : [];

  return (
    <>
      <PageHeader
        title="סקירה"
        sub={`${fmtCount(data.serials.length)} צ׳ בגדוד · ${bulkCount} סוגי ציוד משלים · עודכן ${fmtWhen(now, now)}`}
        actions={
          access.isAdmin ? (
            <Link href="/kesher/import" className="tz-btn tz-btn-tinted tz-btn-sm">
              <Icon name="upload" size={16} />
              ייבוא מהגיליון
            </Link>
          ) : null
        }
      />

      <div className="flex flex-wrap items-start gap-[22px]">
        <div className="flex min-w-0 flex-[2_1_520px] flex-col gap-[22px]">
          <Panel title="פיזור הצ׳" action={<Link href="/kesher/serials" className="text-[13px] font-semibold text-primary no-underline">לכל הצ׳</Link>}>
            <div className="flex flex-col gap-2 border-b border-separator px-4 pb-3 pt-3.5">
              <span className="tz-bar" style={{ height: 8 }} role="img" aria-label={`${wh} במחסן, ${out} על הפלוגות, ${none} ללא שיוך`}>
                {wh ? <span className="ok" style={{ flex: wh }} /> : null}
                {out ? <span style={{ flex: out, background: "var(--primary)" }} /> : null}
                {none ? <span className="broken" style={{ flex: none }} /> : null}
              </span>
              <span className="text-xs text-ink-muted">
                {pct(out)}% מהצ׳ על הפלוגות · {pct(wh)}% במחסן
              </span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
              <Kpi href="/kesher/serials?f=wh" value={fmtCount(wh)} label="במחסן" tile={<SmallTile color="var(--tile-ok)" icon="box" />} />
              <Kpi href="/kesher/companies" value={fmtCount(out)} label="על הפלוגות" tile={<SmallTile color="var(--primary)" icon="people" />} />
              <Kpi href="/kesher/serials?f=none" value={fmtCount(none)} label="ללא שיוך" tile={<SmallTile color="var(--tile-broken)" icon="alert" />} />
              <Kpi
                href="/kesher/log?tab=rep"
                value={
                  <>
                    {fmtCount(seenRecently)}
                    <span className="text-[14px] font-normal text-ink-muted"> / {fmtCount(out)}</span>
                  </>
                }
                label={`נראו בעין ב־${data.staleDays} ימים`}
                tile={<SmallTile color="var(--tile-brigade)" icon="check" />}
              />
            </div>
          </Panel>

          <Panel title="פלוגות" bodyClassName="overflow-x-auto">
            <table className="tz-table">
              <thead>
                <tr>
                  <th>פלוגה</th>
                  <th>צ׳</th>
                  <th>משויכים בפלוגה</th>
                  <th>דוח צ׳ אחרון</th>
                  <th className="max-md:hidden">ציוד משלים</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => {
                  const n = byCompany.get(c.id)?.length ?? 0;
                  const mine = access.covers(c.id) || access.allCompanies;
                  const last = lastChecks.get(c.id);
                  const total = placeTotal(data, c.id);
                  return (
                    <tr key={c.id} className={mine ? "tz-hover" : undefined}>
                      <th scope="row" className="font-semibold">
                        {mine ? (
                          <Link href={`/kesher/companies/${c.id}`} className="text-inherit no-underline">
                            {c.name}
                          </Link>
                        ) : (
                          c.name
                        )}
                      </th>
                      <td className="tz-num">{fmtCount(n)}</td>
                      <td>{mine ? <Meter done={assigned(c.id)} total={n} /> : <span className="text-xs text-ink-muted">—</span>}</td>
                      <td>
                        {mine ? (
                          <span className="flex items-center gap-2">
                            <ReportChip status={companyStatus(last, data.staleDays, now)} />
                            {last ? <span className="text-xs text-ink-muted">{fmtDate(last.at)}</span> : null}
                          </span>
                        ) : (
                          <span className="text-xs text-ink-muted">—</span>
                        )}
                      </td>
                      <td className={`tz-num max-md:hidden ${total ? "" : "tz-zero"}`}>{fmtCount(total)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th>סה״כ</th>
                  <td className="tz-num">{fmtCount(out)}</td>
                  <td>{access.allCompanies ? <Meter done={companies.reduce((t, c) => t + assigned(c.id), 0)} total={out} /> : null}</td>
                  <td />
                  <td className="tz-num max-md:hidden">{fmtCount(companies.reduce((t, c) => t + placeTotal(data, c.id), 0))}</td>
                </tr>
              </tfoot>
            </table>
          </Panel>

          <Panel
            title="חתימות אחרונות"
            action={<Link href="/kesher/log" className="text-[13px] font-semibold text-primary no-underline">ליומן המלא</Link>}
            bodyClassName="overflow-x-auto"
          >
            <EventsTable rows={events} compact now={now} />
          </Panel>
        </div>

        <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-[22px]">
          <Panel title="דורש טיפול">
            {attention.length ? (
              attention.map((a) => <AttentionRow key={a.title} {...a} />)
            ) : (
              <div className="p-6 text-center text-[15px] text-ink-muted">הכל תקין</div>
            )}
          </Panel>

          {data.warehouseTracked && low.length ? (
            <Panel title="ציוד משלים בחוסר במחסן" action={<span className="text-xs text-ink-muted">במחסן</span>}>
              {low.map((i) => (
                <Link key={i.id} href="/kesher/stock" className="tz-row">
                  <span className="tz-row-body min-h-[42px] py-0">
                    <span className="tz-row-title text-[14px]">
                      {i.name}
                      {i.category ? <span className="tz-row-sub text-xs">{i.category}</span> : null}
                    </span>
                    <span className="tz-num text-[14px] font-semibold text-danger">{i.qty}</span>
                    <Icon name="chevron" size={14} className="tz-chevron" />
                  </span>
                </Link>
              ))}
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}

function AttentionRow({ href, tile, title, sub }: { href: string; tile: ReactNode; title: string; sub: string }) {
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
