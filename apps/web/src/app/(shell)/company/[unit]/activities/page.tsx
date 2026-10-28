import Link from "next/link";
import { z } from "zod";
import { addDays, israelToday } from "@gdud/core";
import { withUser } from "@gdud/db";
import { Icon } from "@gdud/ui";
import { Empty, PageHeader, Panel, withParams } from "@/components/page-parts";
import { SegLinks } from "@/app/(shell)/kesher/_components/ui";
import { requireCompanyScope } from "@/lib/company/access";
import { loadActivities, loadSoldierNames, timeRange } from "@/lib/company/data";
import { fmtDay } from "@/lib/doch1/format";
import { ActivityForm } from "../../_components/activity-forms";
import { CompanyPills } from "../../_components/ui";

export const metadata = { title: "פעילויות" };

const paramsSchema = z.object({ unit: z.uuid() });
const searchSchema = z.object({ tab: z.enum(["coming", "past", "new"]).catch("coming") });

/** פעילויות: the company's one-time activities (coming / past) and a new one (the company admin and platoon commanders). */
export default async function ActivitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ unit: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = paramsSchema.safeParse(await params);
  const { s, access, scope } = await requireCompanyScope(p.success ? p.data.unit : "");
  const f = searchSchema.parse(await searchParams);
  const company = scope.company;
  const canCreate = scope.isAdmin || scope.platoons.length > 0;
  const tab = f.tab === "new" && !canCreate ? "coming" : f.tab;
  const today = israelToday(new Date());
  const base = `/company/${company.id}/activities`;

  const { list, soldiers } = await withUser(s.claims, async (tx) => {
    const [list, soldiers] = await Promise.all([
      tab === "new" ? Promise.resolve([]) : loadActivities(tx, company.id, tab === "past" ? { to: today } : { from: today }),
      tab === "new" ? loadSoldierNames(tx, company.id) : Promise.resolve([]),
    ]);
    return { list, soldiers };
  });
  const platoonName = (unitId: string) => s.units.find((u) => u.id === unitId && u.kind === "platoon")?.name ?? null;

  return (
    <>
      <CompanyPills companies={access.companies} current={company.id} path="/activities" />
      <PageHeader title="פעילויות" sub={`${company.name} · פעילות חד־פעמית ומי יוצא אליה. לא נרשם דבר בדוח 1.`} />
      <SegLinks
        label="תצוגה"
        items={[
          { href: base, label: "הבאות", on: tab === "coming" },
          { href: withParams(base, {}, { tab: "past" }), label: "שעברו", on: tab === "past" },
          ...(canCreate ? [{ href: withParams(base, {}, { tab: "new" }), label: "חדשה", on: tab === "new" }] : []),
        ]}
      />
      {tab === "new" ? (
        <Panel title="פעילות חדשה">
          <ActivityForm
            unitId={company.id}
            soldiers={soldiers.map((x) => ({ id: x.id, name: x.name, personalNumber: null, place: platoonName(x.unitId) ?? "מפקדה" }))}
            values={{ name: "", day: addDays(today, 1), startsAt: null, endsAt: null, place: null, commanderPersonId: null, notes: null }}
          />
        </Panel>
      ) : (
        <Panel>
          {list.length === 0 ? (
            <Empty>{tab === "past" ? "אין פעילויות שעברו." : "אין פעילויות מתוכננות."}</Empty>
          ) : (
            list.map((a) => (
              <Link key={a.id} href={`${base}/${a.id}`} className="tz-row">
                <span className="tz-tile" style={{ background: a.day === today ? "var(--primary)" : "var(--tile-neutral)" }}>
                  <Icon name="calendar" size={17} />
                </span>
                <span className="tz-row-body">
                  <span className="tz-row-title">
                    {a.name}
                    <span className="tz-row-sub">{[a.day === today ? "היום" : fmtDay(a.day), timeRange(a), a.place].filter(Boolean).join(" · ")}</span>
                  </span>
                  <Icon name="chevron" size={17} className="tz-chevron" />
                </span>
              </Link>
            ))
          )}
        </Panel>
      )}
    </>
  );
}
