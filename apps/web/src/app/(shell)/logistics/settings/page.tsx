import { notFound } from "next/navigation";
import { DepartmentRoles } from "@/components/department-roles/department-roles";
import { logisticsAccess } from "@/lib/logistics/access";
import { requireModule } from "@/lib/session";
import { PageHeader } from "../_components/ui";

export const metadata = { title: "לוגיסטיקה · הגדרות" };

/** Logistics settings, for the battalion-wide master admin: the department's roles. */
export default async function LogisticsSettings() {
  const s = await requireModule("logistics");
  if (!logisticsAccess(s).isMaster) notFound();

  return (
    <>
      <PageHeader title="הגדרות" sub="הרשאות המשתמשים בלוגיסטיקה" />
      <section className="flex max-w-[860px] flex-col gap-1.5">
        <h2 className="px-4 pb-1 text-[20px] font-bold leading-[26px]">הרשאות</h2>
        <DepartmentRoles s={s} module="logistics" />
      </section>
    </>
  );
}
