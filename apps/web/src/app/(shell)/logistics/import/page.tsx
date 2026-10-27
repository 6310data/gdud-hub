import { notFound } from "next/navigation";
import { MSG } from "@gdud/db/logistics-sheet/preview";
import { ImportFlow } from "@/components/sheet-import/import-flow";
import { logisticsAccess } from "@/lib/logistics/access";
import { requireModule } from "@/lib/session";
import { applySheetImport, inspectSheetFile, previewSheetImport } from "../_actions/sheet-import";
import { PageHeader } from "../_components/ui";

export const metadata = { title: "ייבוא מהגיליון" };

const KIND_LABEL: Record<string, string> = {
  "item.update": "קטלוג",
  "serial.condition": "מצב",
  "assignment.transfer": "העברה",
  "assignment.kit": "ציוד משלים",
  "assignment.return": "זיכוי",
  "storage.release": "שחרור מאפסון",
  "serial.delete": "מחיקה",
  "kit.remove": "הסרה מהתקן",
  "log.add": "היסטוריה",
};

/** Battalion-wide logistics admin or super admin only; the actions check again and RLS a third time. */
export default async function SheetImportPage() {
  const s = await requireModule("logistics");
  if (!logisticsAccess(s).isStockAdmin) notFound();
  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4">
      <PageHeader title="ייבוא מהגיליון" sub="מעדכן את האפליקציה לפי הגיליון. הגיליון עצמו לא משתנה." />
      <ImportFlow
        inspect={inspectSheetFile}
        preview={previewSheetImport}
        apply={applySheetImport}
        sheetName="לוגיסטיקה גדודית"
        defaultTabs={["serials", "assignments", "storage", "log"]}
        lookupTabs={{ people: "לאיתור מספר אישי בלבד" }}
        kindLabels={KIND_LABEL}
        missingSoldier={MSG.noSoldier}
        backHref="/logistics"
        logHref="/logistics/log?kind=sheet_import"
        logName="לוג"
      />
    </div>
  );
}
