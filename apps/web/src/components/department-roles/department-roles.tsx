import { asc, eq, schema, withUser } from "@gdud/db";
import { byHe, getModule, sortAsTree, UNIT_KIND_LABEL, type ModuleId } from "@gdud/core";
import { Field, Row } from "@gdud/ui";
import { ActionButton } from "@/components/action-button";
import { ActionForm } from "@/components/action-form";
import type { Session } from "@/lib/session";
import { grantDepartmentRole, removeDepartmentRole } from "./actions";

/**
 * Settings → הרשאות: who holds which role in this department, and a form to give a role
 * to an invited user. For the department's master admin; inviting new emails stays in /admin.
 */
export async function DepartmentRoles({ s, module }: { s: Session; module: ModuleId }) {
  const def = getModule(module)!;
  const { rows, users } = await withUser(s.claims, async (tx) => {
    const [rows, users] = await Promise.all([
      tx
        .select({
          id: schema.memberships.id,
          role: schema.memberships.role,
          unitId: schema.memberships.unitId,
          userId: schema.appUsers.id,
          email: schema.appUsers.email,
          name: schema.appUsers.displayName,
          active: schema.appUsers.active,
        })
        .from(schema.memberships)
        .innerJoin(schema.appUsers, eq(schema.appUsers.id, schema.memberships.userId))
        .where(eq(schema.memberships.module, module)),
      tx
        .select({ id: schema.appUsers.id, email: schema.appUsers.email, name: schema.appUsers.displayName })
        .from(schema.appUsers)
        .where(eq(schema.appUsers.active, true))
        .orderBy(asc(schema.appUsers.email)),
    ]);
    return { rows, users };
  });

  const unitName = new Map(s.units.map((u) => [u.id, u.name]));
  const unitOptions = sortAsTree(s.units.filter((u) => u.active && (u.kind === "company" || u.kind === "platoon")));
  const label = (u: { name: string | null; email: string }) => u.name ?? u.email;
  const others = users.filter((u) => u.id !== s.user.id).sort((a, b) => byHe(label(a), label(b)));
  const groups = def.roles
    .map((r) => ({ role: r, rows: rows.filter((m) => m.role === r.id).sort((a, b) => byHe(label(a), label(b))) }))
    .filter((g) => g.rows.length);

  return (
    <div className="flex flex-col gap-1.5">
      {groups.length ? null : (
        <div className="tz-group">
          <Row title={<span className="text-ink-muted">עוד אין הרשאות במחלקה</span>} />
        </div>
      )}
      {groups.map((g) => (
        <section key={g.role.id} className="flex flex-col gap-1.5">
          <h3 className="tz-section-header">
            {g.role.label} · <span className="tz-num">{g.rows.length}</span>
          </h3>
          <div className="tz-group">
            {g.rows.map((m) => (
              <Row
                key={m.id}
                title={label(m)}
                sub={
                  <>
                    <span className="tz-serial">{m.email}</span> · {m.unitId ? (unitName.get(m.unitId) ?? "מסגרת לא ידועה") : "כל הגדוד"}
                    {m.active ? "" : " · מושבת"}
                  </>
                }
                trailing={
                  m.userId === s.user.id ? (
                    <span className="tz-footnote pe-4">שלך</span>
                  ) : (
                    <ActionButton action={removeDepartmentRole.bind(null, module, m.id)} label="הסרה" confirmLabel="לאשר הסרה" />
                  )
                }
              />
            ))}
          </div>
          <p className="tz-section-footer">{g.role.description}</p>
        </section>
      ))}

      <h3 className="tz-section-header pt-3.5">מתן הרשאה</h3>
      <div className="tz-group">
        <ActionForm action={grantDepartmentRole} submitLabel="שמירה">
          <input type="hidden" name="module" value={module} />
          <Field label="משתמש">
            <select name="userId" className="tz-input" required defaultValue="">
              <option value="" disabled>
                בחירת משתמש
              </option>
              {others.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ? `${u.name} · ${u.email}` : u.email}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="תפקיד">
              <select name="role" className="tz-input" defaultValue={def.roles.find((r) => r.id === "company_user")?.id}>
                {def.roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="היקף">
              <select name="unitId" className="tz-input" defaultValue="battalion">
                <option value="battalion">כל הגדוד</option>
                {unitOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {"  ".repeat(u.depth)}
                    {u.name} ({UNIT_KIND_LABEL[u.kind]})
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </ActionForm>
      </div>
      <p className="tz-section-footer">
        הרשאה על פלוגה חלה גם על המחלקות שמתחתיה. למשתמש יש תפקיד אחד לכל היקף — שמירה על אותו היקף מחליפה את התפקיד. משתמש חדש
        (מייל שעוד לא הוזמן) מוסיפים בניהול מערכת. את ההרשאות של עצמך משנה מנהל ראשי אחר.
      </p>
    </div>
  );
}
