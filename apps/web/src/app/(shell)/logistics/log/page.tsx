import Link from "next/link";
import { z } from "zod";
import { EVENT_LABEL, LOGISTICS_EVENT_KINDS, normalizeSerial } from "@gdud/core";
import { and, count, desc, eq, ilike, or, schema, sql, withUser } from "@gdud/db";
import { Field, Icon } from "@gdud/ui";
import { fmtCount } from "@/lib/logistics/format";
import { requireModule } from "@/lib/session";
import { EventsTable } from "../_components/events-table";
import { PageHeader } from "../_components/ui";

export const metadata = { title: "לוג פעולות" };

const LIMIT = 300;
const e = schema.logisticsEvents;

/** Escape LIKE wildcards in user input. */
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const text = (max: number) => z.string().trim().max(max).optional().catch(undefined).transform((s) => s || undefined);
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);
const filtersSchema = z.object({
  q: text(80),
  kind: z.enum(LOGISTICS_EVENT_KINDS).optional().catch(undefined),
  name: text(80),
  serial: text(40).transform((s) => (s ? normalizeSerial(s) || undefined : undefined)),
  from: day,
  to: day,
});

/** The Israel calendar day of an event, for the date range. */
const eventDay = sql`(${e.at} at time zone 'Asia/Jerusalem')::date`;

export default async function LogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requireModule("logistics");
  const f = filtersSchema.parse(await searchParams);

  const where = and(
    f.kind ? eq(e.kind, f.kind) : undefined,
    f.name ? ilike(e.personName, like(f.name)) : undefined,
    f.serial ? ilike(e.serial, like(f.serial)) : undefined,
    f.from ? sql`${eventDay} >= ${f.from}::date` : undefined,
    f.to ? sql`${eventDay} <= ${f.to}::date` : undefined,
    f.q
      ? or(
          ilike(e.personName, like(f.q)),
          ilike(e.item, like(f.q)),
          ilike(e.serial, like(f.q)),
          ilike(e.details, like(f.q)),
          ilike(e.actorName, like(f.q)),
          ilike(e.sheetActor, like(f.q)),
        )
      : undefined,
  );

  const [rows, total] = await withUser(s.claims, async (tx) => {
    const list = await tx.select().from(e).where(where).orderBy(desc(e.at), desc(e.id)).limit(LIMIT);
    if (list.length < LIMIT) return [list, list.length] as const;
    const [c] = await tx.select({ n: count() }).from(e).where(where);
    return [list, c?.n ?? list.length] as const;
  });

  const filtered = Object.values(f).some(Boolean);
  const sub = total > rows.length ? `מציג ${fmtCount(rows.length)} האחרונות מתוך ${fmtCount(total)}` : `${fmtCount(total)} פעולות`;
  return (
    <>
      <PageHeader title="לוג פעולות" sub={sub} />
      <form className="tz-card grid grid-cols-2 gap-3 p-4 md:grid-cols-3 xl:grid-cols-6" role="search" aria-label="חיפוש בלוג">
        <Field label="פעולה">
          <select name="kind" className="tz-input" defaultValue={f.kind ?? ""}>
            <option value="">כל הפעולות</option>
            {LOGISTICS_EVENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {EVENT_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="שם חייל">
          <input type="search" name="name" className="tz-input" defaultValue={f.name} maxLength={80} />
        </Field>
        <Field label="צ׳">
          <input type="search" name="serial" className="tz-input tz-serial text-right" dir="ltr" defaultValue={f.serial} maxLength={40} />
        </Field>
        <Field label="מתאריך">
          <input type="date" name="from" className="tz-input" defaultValue={f.from} />
        </Field>
        <Field label="עד תאריך">
          <input type="date" name="to" className="tz-input" defaultValue={f.to} />
        </Field>
        <Field label="טקסט חופשי">
          <input type="search" name="q" className="tz-input" defaultValue={f.q} maxLength={80} placeholder="פריט, הערה, מבצע" />
        </Field>
        <div className="col-span-full flex flex-wrap items-center gap-2">
          <button type="submit" className="tz-btn tz-btn-filled">
            <Icon name="search" size={15} />
            חיפוש
          </button>
          {filtered ? (
            <Link href="/logistics/log" className="tz-btn tz-btn-plain">
              ניקוי
            </Link>
          ) : null}
        </div>
      </form>
      <div className="tz-table-wrap">
        <EventsTable rows={rows} showDetails />
      </div>
    </>
  );
}
