import { notFound } from "next/navigation";
import { KIND_LABEL, MSG } from "@gdud/db/kesher-sheet/preview";
import { PageHeader } from "@/components/page-parts";
import { ImportFlow } from "@/components/sheet-import/import-flow";
import { kesherAccess } from "@/lib/kesher/access";
import { requireModule } from "@/lib/session";
import { applyKesherImport, inspectKesherFile, previewKesherImport } from "../_actions/sheet-import";

export const metadata = { title: "ייבוא מהגיליון" };

/** Battalion-wide kesher admin or super admin only; the actions check again and RLS a third time. */
export default async function KesherImportPage() {
  const s = await requireModule("kesher");
  if (!kesherAccess(s).isAdmin) notFound();
  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4">
      <PageHeader title="ייבוא מהגיליון" sub='עדכון המחלקה מקובץ ה־Excel של "פיזור ושליטה מחלקת קשר", עם תצוגה מקדימה לפני שמירה. הגיליון עצמו לא משתנה.' />
      <ImportFlow
        inspect={inspectKesherFile}
        preview={previewKesherImport}
        apply={applyKesherImport}
        sheetName="פיזור ושליטה מחלקת קשר"
        defaultTabs={["pizur", "companies", "general", "kit", "log", "reports", "checks"]}
        kindLabels={KIND_LABEL}
        missingSoldier={MSG.noSoldier}
        previewNote={MSG.sheetWins}
        backHref="/kesher"
        logHref="/kesher/log?kind=import"
        logName="יומן"
      />
    </div>
  );
}
