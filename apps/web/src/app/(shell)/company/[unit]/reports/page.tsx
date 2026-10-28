import Link from "next/link";
import { z } from "zod";
import { israelToday } from "@gdud/core";
import { desc, eq, schema, withUser, type Tx } from "@gdud/db";
import { Chip, Icon, type IconName } from "@gdud/ui";
import { Empty, PageHeader, Panel, SmallTile } from "@/components/page-parts";
import { requireCompanyScope } from "@/lib/company/access";
import { doch1Access } from "@/lib/doch1/access";
import { listedOn, loadActiveRound, loadDays, loadMembers, membersUnder } from "@/lib/doch1/data";
import { kesherAccess } from "@/lib/kesher/access";
import { fmtWhen } from "@/lib/logistics/format";
import type { Session } from "@/lib/session";
import { CompanyPills } from "../../_components/ui";

export const metadata = { title: "דוחות" };

const { kesherChecks: checks } = schema;
const paramsSchema = z.object({ unit: z.uuid() });

interface Report {
  key: string;
  title: string;
  sub: string;
  href: string;
  icon: IconName;
  color: string;
  status: { done: boolean; text: string } | null;
}

/** Today's דוח 1 of `unitId`: how many listed soldiers have no status yet. */
async function doch1Today(tx: Tx, s: Session, unitId: string, today: string) {
  const round = await loadActiveRound(tx);
  if (!round) return null;
  const members = listedOn(membersUnder(await loadMembers(tx, round.id, s.units), unitId, s.units), today);
  const days = (await loadDays(tx, round.id, [today], { personIds: members.map((m) => m.personId) })).get(today);
  return { members, missing: members.filter((m) => !days?.has(m.personId)).length };
}

/**
 * דוחות: the reports each department expects from the company, one button each — shown only to a
 * user who may file it (the department's own role; the company's כוננות also its admin here), filled
 * inside the company app with the department's own screens. Each says whether today's is done, read
 * from the department's data (under its RLS). Nothing is sent from here.
 */
export default async function CompanyReports({ params }: { params: Promise<{ unit: string }> }) {
  const p = paramsSchema.safeParse(await params);
  const { s, access, scope } = await requireCompanyScope(p.success ? p.data.unit : "");
  const company = scope.company;
  const now = new Date();
  const today = israelToday(now);
  const base = `/company/${company.id}/reports`;

  const d1 = doch1Access(s);
  const platoons = s.units.filter((u) => u.parentId === company.id && u.active);
  // דוח 1 for the company, or for the platoon(s) of a platoon commander
  const d1Unit = d1.canReport(company.id) ? company.id : platoons.find((x) => d1.canReport(x.id))?.id;
  // the company's own כוננות: its admin here, or a דוח 1 admin / company user of the company (item 4)
  const canStandby = d1.canEditCompanyStandby(company.id);
  const canCheck = kesherAccess(s).covers(company.id);

  const status = await withUser(s.claims, async (tx) => {
    const [daily, lastCheck] = await Promise.all([
      d1Unit || canStandby ? doch1Today(tx, s, d1Unit ?? company.id, today) : Promise.resolve(null),
      canCheck
        ? tx.select({ at: checks.at, total: checks.total, found: checks.found }).from(checks).where(eq(checks.unitId, company.id)).orderBy(desc(checks.at)).limit(1)
        : Promise.resolve([]),
    ]);
    return { daily, lastCheck: lastCheck[0] ?? null };
  });

  const reports: Report[] = [];
  if (d1Unit) {
    const d = status.daily;
    reports.push({
      key: "doch1",
      title: "דוח 1 של היום",
      sub: d1Unit === company.id ? company.name : (platoons.find((x) => x.id === d1Unit)?.name ?? ""),
      href: `${base}/today${d1Unit === company.id ? "" : `?unit=${d1Unit}`}`,
      icon: "list",
      color: "var(--primary)",
      status: d ? (d.missing ? { done: false, text: `חסרים ${d.missing} מתוך ${d.members.length}` } : { done: true, text: "הושלם" }) : null,
    });
  }
  if (canStandby) {
    const unplaced = status.daily ? status.daily.members.filter((m) => !m.locationId).length : 0;
    reports.push({
      key: "standby",
      title: "שבצ״ק וכוננות",
      sub: `${company.name} · הצוותים והרכבים של הפלוגה`,
      href: `${base}/standby`,
      icon: "shield",
      color: "var(--tile-brigade)",
      status: status.daily ? (unplaced ? { done: false, text: `${unplaced} בלי מיקום בשבצ״ק` } : { done: true, text: "כולם משובצים" }) : null,
    });
  }
  if (canCheck) {
    const c = status.lastCheck;
    const todays = c && israelToday(c.at) === today;
    reports.push({
      key: "check",
      title: "דוח צ׳",
      sub: c ? `אחרון: ${fmtWhen(c.at, now)} · ${c.found}/${c.total} נראו` : "עדיין לא הוגש",
      href: `${base}/check`,
      icon: "check",
      color: "var(--tile-broken)",
      status: todays ? { done: c.found === c.total, text: c.found === c.total ? "הוגש היום" : `הוגש היום · ${c.total - c.found} לא נמצאו` } : { done: false, text: "לא הוגש היום" },
    });
  }

  return (
    <>
      <CompanyPills companies={access.companies} current={company.id} path="/reports" />
      <PageHeader title="דוחות" sub={`${company.name} · הדוחות שהמחלקות מצפות להם מהפלוגה, למילוי כאן.`} />
      <Panel>
        {reports.length === 0 ? (
          <Empty>אין לך הרשאה למלא דוחות של הפלוגה במחלקות. מנהל הפלוגה נותן הרשאות בהגדרות.</Empty>
        ) : (
          reports.map((r) => (
            <Link key={r.key} href={r.href} className="tz-row">
              <SmallTile color={r.color} icon={r.icon} />
              <span className="tz-row-body py-2.5">
                <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                  <span className="tz-row-title">{r.title}</span>
                  <span className="tz-row-sub">{r.sub}</span>
                  {r.status ? <Chip tone={r.status.done ? "ok" : "broken"}>{r.status.text}</Chip> : null}
                </span>
                <Icon name="chevron" size={17} className="tz-chevron" />
              </span>
            </Link>
          ))
        )}
      </Panel>
    </>
  );
}
