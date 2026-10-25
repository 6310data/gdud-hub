import { notFound } from "next/navigation";
import { logisticsAccess } from "@/lib/logistics/access";
import { requireModule } from "@/lib/session";
import { PageHeader } from "../_components/ui";
import { ImportFlow } from "./import-flow";

export const metadata = { title: "ייבוא מהגיליון" };

/** Battalion-wide logistics admin or super admin only; the actions check again and RLS a third time. */
export default async function SheetImportPage() {
  const s = await requireModule("logistics");
  if (!logisticsAccess(s).isStockAdmin) notFound();
  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4">
      <PageHeader title="ייבוא מהגיליון" sub="מעדכן את האפליקציה לפי הגיליון. הגיליון עצמו לא משתנה." />
      <ImportFlow />
    </div>
  );
}
