/**
 * דוח צ׳ of one company — the form with every צ׳ on the company to tick as seen. Shared by /kesher/check
 * and ניהול פלוגה → דוחות (spec "Changes requested 2026-10-28", item 3): the same data, rules and
 * action (fileCheck: anyone covering the company in kesher files it; the reporter is the signed-in user).
 */
import Link from "next/link";
import { byHe, type UnitNode } from "@gdud/core";
import { withUser } from "@gdud/db";
import { Empty, PageHeader } from "@/components/page-parts";
import { groupBy, loadKesher, loadLastChecks, loadLastSeen } from "@/lib/kesher/data";
import { fmtCount, fmtWhen } from "@/lib/logistics/format";
import { displayName, type Session } from "@/lib/session";
import { CompanyDot, pillCount } from "../_components/ui";
import { PushToggle } from "../../doch1/_components/push-toggle";
import { CheckForm, type CheckGroup } from "./_components/check-form";

export async function CheckScreen({
  s,
  company,
  companies,
  path,
  done,
}: {
  s: Session;
  company: Pick<UnitNode, "id" | "name" | "color">;
  /** the pills to switch company (none when there is one) */
  companies: Pick<UnitNode, "id" | "name" | "color">[];
  /** pill links: `${path}?unit=<id>` */
  path: string;
  /** "done" link after filing (default: the kesher company page) */
  done?: { href: string; label: string };
}) {
  const now = new Date();
  const { data, lastChecks, lastSeen } = await withUser(s.claims, async (tx) => {
    const [data, lastChecks, lastSeen] = await Promise.all([loadKesher(tx, s.units), loadLastChecks(tx), loadLastSeen(tx)]);
    return { data, lastChecks, lastSeen };
  });
  const byCompany = groupBy(
    data.serials.filter((x) => x.location === "company"),
    (x) => x.unitId,
  );
  const mine = byCompany.get(company.id) ?? [];
  const groups: CheckGroup[] = [...groupBy(mine, (x) => x.itemName)]
    .sort(([a], [b]) => byHe(a, b))
    .map(([type, list]) => ({
      type,
      rows: list.map((x) => ({
        id: x.id,
        serial: x.serial,
        holder: [x.holder?.holder?.name, x.holder?.holderRole, x.holder?.frame].filter(Boolean).join(" · ") || null,
        missedLast: lastSeen.get(x.id)?.found === false,
      })),
    }));
  const last = lastChecks.get(company.id);

  return (
    <>
      {companies.length > 1 ? (
        <nav className="tz-pills" aria-label="פלוגות">
          {companies.map((c) => (
            <Link key={c.id} href={`${path}?unit=${c.id}`} className="tz-pill" aria-current={c.id === company.id ? "page" : undefined}>
              <CompanyDot color={c.color} />
              {c.name} {pillCount(byCompany.get(c.id)?.length ?? 0)}
            </Link>
          ))}
        </nav>
      ) : null}
      <PageHeader
        title={`דוח צ׳ · ${company.name}`}
        sub={`${fmtCount(mine.length)} צ׳ על הפלוגה · מסמנים כל צ׳ שנראה בעין${last ? ` · דוח אחרון ${fmtWhen(last.at, now)}${last.reporterName ? ` (${last.reporterName})` : ""}` : ""}`}
      />
      {mine.length ? (
        <CheckForm
          key={company.id}
          unitId={company.id}
          companyName={company.name}
          reporter={displayName(s.user, s.claims)}
          groups={groups}
          doneHref={done?.href}
          doneLabel={done?.label}
        />
      ) : (
        <div className="tz-card">
          <Empty>אין צ׳ על הפלוגה — אין מה לדווח.</Empty>
        </div>
      )}
      <Reminders />
    </>
  );
}

/** "קבלת תזכורות לדוח צ׳" on this device (hidden when the browser can't get push: the toggle renders nothing). */
export function Reminders() {
  return (
    <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 px-4 has-[button]:flex has-[p]:flex">
      <span className="tz-footnote">קבלת תזכורות לדוח צ׳</span>
      <PushToggle />
    </div>
  );
}
