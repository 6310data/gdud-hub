import Link from "next/link";
import { z } from "zod";
import { EVENT_LABEL, LOGISTICS_EVENT_KINDS } from "@gdud/core";
import { and, desc, eq, ilike, or, schema, withUser } from "@gdud/db";
import { Icon } from "@gdud/ui";
import { requireModule } from "@/lib/session";
import { EventsTable } from "../_components/events-table";
import { PageHeader, withParams } from "../_components/ui";

export const metadata = { title: "לוג פעולות" };

const LIMIT = 300;
const e = schema.logisticsEvents;

/** Escape LIKE wildcards in user input. */
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export default async function LogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requireModule("logistics");
  const sp = z
    .object({ q: z.string().trim().max(80).optional().catch(undefined), kind: z.enum(LOGISTICS_EVENT_KINDS).optional().catch(undefined) })
    .parse(await searchParams);

  const rows = await withUser(s.claims, (tx) =>
    tx
      .select()
      .from(e)
      .where(
        and(
          sp.kind ? eq(e.kind, sp.kind) : undefined,
          sp.q
            ? or(ilike(e.personName, like(sp.q)), ilike(e.item, like(sp.q)), ilike(e.serial, like(sp.q)), ilike(e.details, like(sp.q)), ilike(e.actorName, like(sp.q)))
            : undefined,
        ),
      )
      .orderBy(desc(e.at))
      .limit(LIMIT),
  );

  const kinds = ["sign", "return", "transfer", "store", "release", "serials_add", "condition"] as const;
  return (
    <>
      <PageHeader title="לוג פעולות" sub={rows.length === LIMIT ? `${LIMIT} הפעולות האחרונות` : `${rows.length} פעולות`} />
      <div className="flex flex-wrap items-center gap-3">
        <form className="tz-search min-w-[220px] flex-1 bg-surface lg:max-w-[340px]" role="search">
          {sp.kind ? <input type="hidden" name="kind" value={sp.kind} /> : null}
          <Icon name="search" size={15} />
          <input type="search" name="q" defaultValue={sp.q} placeholder="סינון: שם, צ׳, פריט, הערה" aria-label="סינון הלוג" />
        </form>
        <nav className="tz-pills" aria-label="סוג פעולה">
          <Link aria-current={(!sp.kind) ? "page" : undefined} className="tz-pill" href={withParams("/logistics/log", { q: sp.q }, {})}>
            הכל
          </Link>
          {kinds.map((k) => (
            <Link key={k} aria-current={(sp.kind === k) ? "page" : undefined} className="tz-pill" href={withParams("/logistics/log", { q: sp.q }, { kind: k })}>
              {EVENT_LABEL[k]}
            </Link>
          ))}
        </nav>
      </div>
      <div className="tz-table-wrap">
        <EventsTable rows={rows} showDetails />
      </div>
    </>
  );
}
