import { notFound } from "next/navigation";
import { z } from "zod";
import { withUser } from "@gdud/db";
import { PageHeader, Panel } from "@/components/page-parts";
import { requireCompanyScope } from "@/lib/company/access";
import { loadChangeRequests, loadJoinRequests, subtreeIds } from "@/lib/company/data";
import { ChangeRequests, CompanyPills, JoinRequests } from "../../_components/ui";

export const metadata = { title: "הגדרות פלוגה" };

const paramsSchema = z.object({ unit: z.uuid() });

/** הגדרות (company admin): join requests and the company's name / תפקיד change requests. */
export default async function CompanySettings({ params }: { params: Promise<{ unit: string }> }) {
  const p = paramsSchema.safeParse(await params);
  const { s, access, scope } = await requireCompanyScope(p.success ? p.data.unit : "");
  if (!scope.isAdmin) notFound();
  const company = scope.company;
  const unitIds = subtreeIds(company.id, s.units);
  const now = new Date();

  const { joins, changes } = await withUser(s.claims, async (tx) => {
    const [joins, changes] = await Promise.all([loadJoinRequests(tx, unitIds), loadChangeRequests(tx, unitIds)]);
    return { joins, changes };
  });
  const place = (id: string) => {
    const u = s.units.find((x) => x.id === id);
    return u && u.id !== company.id ? `${company.name} · ${u.name}` : company.name;
  };

  return (
    <>
      <CompanyPills companies={access.companies.filter((c) => c.isAdmin)} current={company.id} path="/settings" />
      <PageHeader title="הגדרות" sub={company.name} />
      <Panel title={`בקשות הצטרפות (${joins.length})`}>
        <JoinRequests rows={joins} place={place} now={now} />
      </Panel>
      <p className="tz-footnote m-0 px-1">
        אשרו רק אחרי שבדקתם שהחשבון באמת של החייל (למשל בשיחה איתו). חייל שלא מוצא את הבקשה שלו כאן — כנראה הקליד מספר אישי או טלפון שלא תואמים לרשום בדוח 1.
      </p>
      <Panel title={`בקשות לעדכון פרטים (${changes.length})`}>
        <ChangeRequests rows={changes} place={place} now={now} selfId={access.personId} />
      </Panel>
    </>
  );
}
