import Link from "next/link";
import { z } from "zod";
import { KESHER_EVENT_KINDS, KESHER_EVENT_LABEL } from "@gdud/core";
import { and, desc, eq, ilike, inArray, or, schema, withUser } from "@gdud/db";
import { Chip, Field, Serial } from "@gdud/ui";
import { Empty, PageHeader, withParams } from "@/components/page-parts";
import { kesherAccess } from "@/lib/kesher/access";
import { fmtCount, fmtWhen } from "@/lib/logistics/format";
import { requireModule } from "@/lib/session";
import { EventsTable } from "../_components/events-table";
import { Meter, SegLinks } from "../_components/ui";

export const metadata = { title: "יומן" };

const PAGE = 100;
const e = schema.kesherEvents;
const c = schema.kesherChecks;

/** Escape LIKE wildcards in user input. */
const like = (q: string) => `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

const searchSchema = z.object({
  tab: z.enum(["sign", "rep"]).catch("sign"),
  q: z.string().trim().max(80).optional().catch(undefined),
  unit: z.uuid().optional().catch(undefined),
  kind: z.enum(KESHER_EVENT_KINDS).optional().catch(undefined),
  page: z.coerce.number().int().min(0).max(1000).catch(0),
});

/**
 * יומן (mockup #/log): יומן חתימות and דוחות צ׳, newest first, 100 per page. RLS shows a company
 * user only their companies' rows (plus warehouse and catalogue rows with no soldier).
 */
export default async function KesherLog({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requireModule("kesher");
  const access = kesherAccess(s);
  const f = searchSchema.parse(await searchParams);
  const now = new Date();
  const companyName = new Map(access.companies.map((u) => [u.id, u.name]));
  const current = { tab: f.tab === "rep" ? "rep" : undefined, q: f.q, unit: f.unit, kind: f.kind };

  const result = await withUser(s.claims, async (tx) => {
    if (f.tab === "sign") {
      const where = and(
        f.unit ? eq(e.unitId, f.unit) : undefined,
        f.kind ? eq(e.kind, f.kind) : undefined,
        f.q
          ? or(ilike(e.personName, like(f.q)), ilike(e.serial, like(f.q)), ilike(e.item, like(f.q)), ilike(e.actorName, like(f.q)), ilike(e.sheetActor, like(f.q)), ilike(e.details, like(f.q)))
          : undefined,
      );
      const rows = await tx.select().from(e).where(where).orderBy(desc(e.at), desc(e.id)).limit(PAGE + 1).offset(f.page * PAGE);
      return { events: rows, reports: [] as never[], missing: new Map<string, string[]>() };
    }
    const where = and(f.unit ? eq(c.unitId, f.unit) : undefined, f.q ? or(ilike(c.reporterName, like(f.q)), ilike(c.note, like(f.q))) : undefined);
    const reports = await tx.select().from(c).where(where).orderBy(desc(c.at)).limit(PAGE + 1).offset(f.page * PAGE);
    const ids = reports.map((r) => r.id);
    const lines = ids.length
      ? await tx
          .select({ checkId: schema.kesherCheckLines.checkId, serial: schema.kesherCheckLines.serial })
          .from(schema.kesherCheckLines)
          .where(and(inArray(schema.kesherCheckLines.checkId, ids), eq(schema.kesherCheckLines.found, false)))
      : [];
    const missing = new Map<string, string[]>();
    for (const l of lines) missing.set(l.checkId, [...(missing.get(l.checkId) ?? []), l.serial]);
    return { events: [], reports, missing };
  });

  const more = (f.tab === "sign" ? result.events.length : result.reports.length) > PAGE;
  const events = result.events.slice(0, PAGE);
  const reports = result.reports.slice(0, PAGE);

  return (
    <>
      <PageHeader title="יומן" sub={f.tab === "sign" ? "החתמות, זיכויים, שיוכים וייבוא — מהחדש לישן" : "כל דוחות הצ׳ שהוגשו"} />
      <SegLinks
        label="יומן"
        items={[
          { href: withParams("/kesher/log", { q: f.q, unit: f.unit }, {}), label: "יומן חתימות", on: f.tab === "sign" },
          { href: withParams("/kesher/log", { q: f.q, unit: f.unit }, { tab: "rep" }), label: "דוחות צ׳", on: f.tab === "rep" },
        ]}
      />
      <form action="/kesher/log" role="search" aria-label="חיפוש ביומן" className="tz-card grid grid-cols-2 items-end gap-3 p-4 md:grid-cols-4">
        {f.tab === "rep" ? <input type="hidden" name="tab" value="rep" /> : null}
        <Field label="חיפוש">
          <input type="search" name="q" className="tz-input" defaultValue={f.q} placeholder={f.tab === "sign" ? "צ׳, חותם, מחתים או פריט" : "מדווח או הערה"} />
        </Field>
        <Field label="פלוגה">
          <select name="unit" className="tz-input" defaultValue={f.unit ?? ""}>
            <option value="">הכל</option>
            {access.companies.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
        {f.tab === "sign" ? (
          <Field label="פעולה">
            <select name="kind" className="tz-input" defaultValue={f.kind ?? ""}>
              <option value="">הכל</option>
              {KESHER_EVENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KESHER_EVENT_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <button type="submit" className="tz-btn tz-btn-tinted">
          סינון
        </button>
      </form>

      <div className="tz-table-wrap">
        {f.tab === "sign" ? (
          <EventsTable rows={events} now={now} />
        ) : reports.length ? (
          <table className="tz-table">
            <thead>
              <tr>
                <th>מתי</th>
                <th>פלוגה</th>
                <th>מדווח</th>
                <th>נראו בעין</th>
                <th>לא נמצאו</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => {
                const miss = result.missing.get(r.id) ?? [];
                const n = r.total - r.found;
                return (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-ink-muted">{fmtWhen(r.at, now)}</td>
                    <td>{companyName.get(r.unitId) ?? "—"}</td>
                    <td>
                      {r.reporterName ?? "—"}
                      {r.note ? <span className="tz-row-sub text-xs">{r.note}</span> : null}
                    </td>
                    <td>
                      <Meter done={r.found} total={r.total} />
                    </td>
                    <td className="whitespace-normal">
                      {n ? (
                        <>
                          <span className="font-semibold text-danger">{n}</span>{" "}
                          <span className="text-xs">
                            {miss.map((m, i) => (
                              <span key={m}>
                                {i ? ", " : ""}
                                <Serial>{m}</Serial>
                              </span>
                            ))}
                          </span>
                        </>
                      ) : (
                        <Chip tone="ok">הכל נמצא</Chip>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty>אין דוח תואם</Empty>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {f.page > 0 ? (
          <Link href={withParams("/kesher/log", current, { page: f.page > 1 ? String(f.page - 1) : null })} className="tz-btn tz-btn-plain tz-btn-sm">
            החדשים
          </Link>
        ) : null}
        {more ? (
          <Link href={withParams("/kesher/log", current, { page: String(f.page + 1) })} className="tz-btn tz-btn-tinted tz-btn-sm">
            הקודמים
          </Link>
        ) : null}
        <span className="tz-footnote">
          {fmtCount(f.page * PAGE + 1)}–{fmtCount(f.page * PAGE + (f.tab === "sign" ? events.length : reports.length))}
        </span>
      </div>
    </>
  );
}
