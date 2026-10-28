import { notFound } from "next/navigation";
import { doch1Access } from "@/lib/doch1/access";
import { doch1Rounds } from "@/lib/doch1/rounds";
import { requireModule } from "@/lib/session";
import { ImportFlow } from "./_components/import-flow";

export const metadata = { title: "דוח 1 · ייבוא" };
// The first import of a round writes tens of thousands of day cells in one transaction.
export const maxDuration = 300;

export default async function Doch1Import() {
  const s = await requireModule("doch1");
  if (!doch1Access(s).isAdmin) notFound();
  const { active: round } = await doch1Rounds(s);
  if (!round) return null; // the layout shows "אין סבב פעיל"

  return (
    <div className="flex w-full max-w-[960px] flex-col gap-[22px]">
      <div className="flex flex-col">
        <h1 className="tz-title">ייבוא הגיליון</h1>
        <span className="tz-footnote">חיילים, פרטי סבב וימים מהגיליון ״דוח 1״. אפשר לייבא שוב בכל פעם שהגיליון מתעדכן.</span>
      </div>
      <ImportFlow roundName={round.name} />
    </div>
  );
}
