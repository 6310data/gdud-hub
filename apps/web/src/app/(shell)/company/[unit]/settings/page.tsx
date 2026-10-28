import { notFound } from "next/navigation";
import { z } from "zod";
import { COMPANY_GRANTABLE, roleLabel, getModule } from "@gdud/core";
import { withUser } from "@gdud/db";
import { Chip, Field } from "@gdud/ui";
import { ActionButton } from "@/components/action-button";
import { ActionForm } from "@/components/action-form";
import { Empty, PageHeader, Panel } from "@/components/page-parts";
import { requireCompanyScope } from "@/lib/company/access";
import { loadAccessList, loadChangeRequests, loadJoinRequests, subtreeIds } from "@/lib/company/data";
import { grantRole, revokeRole } from "../../_actions/roles";
import { ChangeRequests, CompanyPills, JoinRequests } from "../../_components/ui";

export const metadata = { title: "הגדרות פלוגה" };

const paramsSchema = z.object({ unit: z.uuid() });

/**
 * הגדרות (company admin): join requests, the company's name / תפקיד change requests, and הרשאות —
 * the company-level roles (in this module, דוח 1, לוגיסטיקה, קשר) of the accounts linked to the
 * company's soldiers. Roles given here can be taken back here; the rest show read-only.
 */
export default async function CompanySettings({ params }: { params: Promise<{ unit: string }> }) {
  const p = paramsSchema.safeParse(await params);
  const { s, access, scope } = await requireCompanyScope(p.success ? p.data.unit : "");
  if (!scope.isAdmin) notFound();
  const company = scope.company;
  const unitIds = subtreeIds(company.id, s.units);
  const now = new Date();

  const { joins, changes, accounts } = await withUser(s.claims, async (tx) => {
    const [joins, changes, accounts] = await Promise.all([loadJoinRequests(tx, unitIds), loadChangeRequests(tx, unitIds), loadAccessList(tx, company.id)]);
    return { joins, changes, accounts };
  });
  const platoons = s.units.filter((u) => u.parentId === company.id && u.active).sort((a, b) => a.sortOrder - b.sortOrder);
  const unitLabel = (id: string | null) => (id === null ? "כל הגדוד" : (s.units.find((u) => u.id === id)?.name ?? "—"));
  const grants = COMPANY_GRANTABLE.flatMap((g) =>
    (g.level === "company" ? [company] : platoons).map((u) => ({
      value: `${g.module}:${g.role}:${u.id}`,
      label: `${getModule(g.module)?.name ?? g.module} · ${roleLabel(g.module, g.role)} · ${u.name}`,
    })),
  );
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

      <Panel title="הרשאות">
        {accounts.length === 0 ? (
          <Empty>אין עדיין חשבונות שמקושרים לחיילי הפלוגה.</Empty>
        ) : (
          <>
            <ActionForm action={grantRole} submitLabel="מתן הרשאה" variant="tinted" className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <input type="hidden" name="companyId" value={company.id} />
              <Field label="חשבון">
                <select name="userId" className="tz-input" required defaultValue="">
                  <option value="">בחרו…</option>
                  {accounts
                    .filter((a) => a.userId !== s.user.id)
                    .map((a) => (
                      <option key={a.userId} value={a.userId}>
                        {a.fullName} · {a.email}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="הרשאה">
                <select name="grant" className="tz-input" required defaultValue="">
                  <option value="">בחרו…</option>
                  {grants.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </Field>
            </ActionForm>
            {accounts.map((a) => (
              <div key={a.userId} className="flex flex-wrap items-center gap-2 border-t border-[var(--separator)] px-4 py-3">
                <span className="flex min-w-[180px] flex-1 flex-col">
                  <span className="font-semibold">{a.fullName}</span>
                  <span className="tz-footnote tz-serial">{a.email}</span>
                </span>
                {a.roles.length === 0 ? <span className="tz-footnote">חייל — רק הדף האישי</span> : null}
                {a.roles.map((r) => (
                  <span key={r.membershipId} className="inline-flex items-center gap-1">
                    <Chip tone={r.editable ? "signed" : "admin"}>
                      {getModule(r.module)?.name ?? r.module} · {roleLabel(r.module, r.role)} · {unitLabel(r.unitId)}
                    </Chip>
                    {r.editable ? <ActionButton action={revokeRole.bind(null, r.membershipId)} label="הסרה" confirmLabel="להסיר?" /> : null}
                  </span>
                ))}
              </div>
            ))}
          </>
        )}
      </Panel>
      <p className="tz-footnote m-0 px-1">
        מנהל פלוגה נותן רק הרשאות פלוגה ומחלקה שאינן ניהול. הרשאה שניתנה במחלקה או בניהול מערכת מוצגת כאן לקריאה בלבד. מנהל פלוגה נוסף — דרך ניהול מערכת.
      </p>
    </>
  );
}
