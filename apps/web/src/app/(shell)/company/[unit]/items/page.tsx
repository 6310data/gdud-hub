import { notFound } from "next/navigation";
import { z } from "zod";
import { asc, eq, schema, withUser } from "@gdud/db";
import { Chip, Field, Serial } from "@gdud/ui";
import { ActionForm } from "@/components/action-form";
import { Empty, PageHeader, Panel } from "@/components/page-parts";
import { requireCompanyScope } from "@/lib/company/access";
import { loadRegisterItems } from "@/lib/company/data";
import { addCompanyItem } from "../../_actions/register";
import { ItemControls } from "../../_components/item-controls";
import { CompanyPills } from "../../_components/ui";

export const metadata = { title: "פריטי פלוגה" };

const { companyItems: items } = schema;
const paramsSchema = z.object({ unit: z.uuid() });

/** פריטי פלוגה (company admin): the company's own catalog — with a צ׳ (one unit) or a quantity. */
export default async function ItemsPage({ params }: { params: Promise<{ unit: string }> }) {
  const p = paramsSchema.safeParse(await params);
  const { s, access, scope } = await requireCompanyScope(p.success ? p.data.unit : "");
  if (!scope.isAdmin) notFound();
  const company = scope.company;

  const { rows, register } = await withUser(s.claims, async (tx) => {
    const [rows, register] = await Promise.all([
      tx.select().from(items).where(eq(items.unitId, company.id)).orderBy(asc(items.category), asc(items.name)),
      loadRegisterItems(tx, company.id),
    ]);
    return { rows, register };
  });
  const out = new Map(register.filter((r) => r.kind === "company").map((r) => [r.id, r]));

  return (
    <>
      <CompanyPills companies={access.companies.filter((c) => c.isAdmin)} current={company.id} path="/items" />
      <PageHeader title="פריטי פלוגה" sub={`${company.name} · ציוד שבבעלות הפלוגה (אוהלים, גנרטורים, ציוד בישול …), להחתמה פנימית`} />
      <Panel title="פריט חדש">
        <ActionForm action={addCompanyItem} submitLabel="הוספה">
          <input type="hidden" name="unitId" value={company.id} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="שם">
              <input name="name" className="tz-input" required maxLength={80} />
            </Field>
            <Field label="קטגוריה">
              <input name="category" className="tz-input" maxLength={40} />
            </Field>
            <Field label="צ׳ (ריק = פריט בכמות)">
              <input name="serial" className="tz-input tz-serial" maxLength={40} dir="ltr" />
            </Field>
            <Field label="כמות (לפריט בלי צ׳)">
              <input name="quantity" type="number" className="tz-input tz-num" min={1} max={9999} defaultValue={1} />
            </Field>
          </div>
          <Field label="הערות">
            <input name="notes" className="tz-input" maxLength={500} />
          </Field>
        </ActionForm>
      </Panel>
      <Panel title={`הפריטים (${rows.length})`}>
        {rows.length === 0 ? (
          <Empty>אין עדיין פריטים לפלוגה.</Empty>
        ) : (
          <div className="tz-table-wrap">
            <table className="tz-table">
              <thead>
                <tr>
                  <th>פריט</th>
                  <th>קטגוריה</th>
                  <th>צ׳ / כמות</th>
                  <th>מוחתם</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => {
                  const reg = out.get(i.id);
                  const signed = reg ? (i.serial ? (reg.nowName ? `אצל ${reg.nowName}` : "—") : `${i.quantity - reg.available} מתוך ${i.quantity}`) : "—";
                  return (
                    <tr key={i.id}>
                      <td>
                        <span className="font-semibold">{i.name}</span> {i.active ? null : <Chip tone="signed">לא בשימוש</Chip>}
                        {i.notes ? <div className="tz-footnote">{i.notes}</div> : null}
                      </td>
                      <td>{i.category ?? "—"}</td>
                      <td>{i.serial ? <Serial>{i.serial}</Serial> : <span className="tz-num">{i.quantity}</span>}</td>
                      <td>{signed}</td>
                      <td>
                        <ItemControls id={i.id} unitId={company.id} quantity={i.quantity} active={i.active} serial={i.serial} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
