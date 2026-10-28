import { notFound } from "next/navigation";
import { asc, schema, withUser } from "@gdud/db";
import { PageHeader } from "@/components/page-parts";
import { DepartmentRoles } from "@/components/department-roles/department-roles";
import { kesherAccess } from "@/lib/kesher/access";
import { requireModule } from "@/lib/session";
import { CategoriesEditor } from "./_components/categories";
import { SettingsForm } from "./_components/settings-form";

export const metadata = { title: "מחלקת קשר · הגדרות" };

/**
 * הגדרות מחלקת קשר (battalion kesher admin): when a דוח צ׳ / צהוב בעיניים counts as old, the push
 * notifications of דוח צ׳, and — for the master admin — the department's roles.
 */
export default async function KesherSettings() {
  const s = await requireModule("kesher");
  const access = kesherAccess(s);
  if (!access.isAdmin) notFound();

  const { cfg, items } = await withUser(s.claims, async (tx) => {
    const [[cfg], items] = await Promise.all([
      tx
        .select({
          checkStaleDays: schema.kesherSettings.checkStaleDays,
          eyeWarnDays: schema.kesherSettings.eyeWarnDays,
          eyeAlertDays: schema.kesherSettings.eyeAlertDays,
          notifyMissing: schema.kesherSettings.notifyMissing,
          reminderHour: schema.kesherSettings.reminderHour,
        })
        .from(schema.kesherSettings)
        .limit(1),
      tx
        .select({ id: schema.kesherItems.id, name: schema.kesherItems.name, kind: schema.kesherItems.kind, category: schema.kesherItems.category })
        .from(schema.kesherItems)
        .orderBy(asc(schema.kesherItems.sortOrder), asc(schema.kesherItems.name)),
    ]);
    return { cfg, items };
  });

  return (
    <>
      <PageHeader title="הגדרות" sub="דוחות צ׳, צהוב בעיניים, התראות, קטגוריות והרשאות" />
      <SettingsForm initial={cfg ?? { checkStaleDays: 7, eyeWarnDays: 3, eyeAlertDays: 7, notifyMissing: true, reminderHour: 9 }} />
      <section className="flex max-w-[860px] flex-col gap-1.5">
        <h2 className="px-4 pb-1 text-[20px] font-bold leading-[26px]">קטגוריות</h2>
        <CategoriesEditor items={items.map((i) => ({ id: i.id, name: i.name, serial: i.kind === "serial", category: i.category }))} />
      </section>
      <section className="flex max-w-[860px] flex-col gap-1.5">
        <h2 className="px-4 pb-1 text-[20px] font-bold leading-[26px]">הרשאות</h2>
        {access.isMaster ? <DepartmentRoles s={s} module="kesher" /> : <p className="tz-footnote m-0 px-4">ניהול הרשאות — למנהל ראשי</p>}
      </section>
    </>
  );
}
