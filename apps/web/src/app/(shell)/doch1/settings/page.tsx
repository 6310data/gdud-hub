import { notFound } from "next/navigation";
import { byHe } from "@gdud/core";
import { desc, schema, withUser } from "@gdud/db";
import { doch1Access } from "@/lib/doch1/access";
import { countMembersByCompany, loadRoundCompanies, loadStatuses, toRoundVM } from "@/lib/doch1/data";
import { fmtDay } from "@/lib/doch1/format";
import { requireModule } from "@/lib/session";
import { Panel } from "../_components/panel";
import { CompaniesTable, type CompanyRow } from "./_components/companies-table";
import { RoundForm } from "./_components/round-form";
import { StatusEditor } from "./_components/status-editor";

export const metadata = { title: "דוח 1 · הגדרות" };

export default async function Doch1Settings() {
  const s = await requireModule("doch1");
  if (!doch1Access(s).isAdmin) notFound();

  const data = await withUser(s.claims, async (tx) => {
    const rounds = await tx.select().from(schema.doch1Rounds).orderBy(desc(schema.doch1Rounds.startsOn));
    const active = rounds.find((r) => r.active) ?? null;
    if (!active) return { rounds, active, companies: [], statuses: [], replaced: 0, counts: new Map<string, number>() };
    const [companies, all, counts] = await Promise.all([
      loadRoundCompanies(tx, active.id),
      loadStatuses(tx, active.id, { includeInactive: true }),
      countMembersByCompany(tx, active.id, s.units),
    ]);
    const current = all.filter((x) => x.active);
    return { rounds, active, companies, statuses: current, replaced: all.length - current.length, counts };
  });

  const active = data.active ? toRoundVM(data.active) : null;
  const companyRows: CompanyRow[] = s.units
    .filter((u) => u.kind === "company" && u.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || byHe(a.name, b.name))
    .map((u) => {
      const rc = data.companies.find((c) => c.unitId === u.id);
      return {
        unitId: u.id,
        name: u.name,
        inRound: !!rc,
        active: rc?.active ?? false,
        appFrom: rc?.appFrom ?? null,
        members: data.counts.get(u.id) ?? 0,
      };
    });
  const others = data.rounds.filter((r) => !r.active).map(toRoundVM);

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-col">
        <h1 className="tz-title">הגדרות</h1>
        <span className="tz-footnote">שינוי בהגדרות חל מהיום והלאה. ימים שכבר דווחו נשארים כמו שהם.</span>
      </div>

      <Panel title={active ? `סבב נוכחי · ${active.name}` : "סבב חדש"}>
        <RoundForm round={active ? { ...active, active: true } : null} />
      </Panel>

      {active ? (
        <>
          <Panel
            title="פלוגות ומסגרות"
            footer="פלוגה לא פעילה לא נספרת בסבב. ״דיווח באפליקציה מתאריך״ מפעיל את הפיילוט: מהתאריך הזה הייבוא מהגיליון לא משנה את ימי הפלוגה."
          >
            <CompaniesTable roundId={active.id} rows={companyRows} />
          </Panel>

          <Panel
            title="סטטוסים"
            footer={`כל הספירות מחושבות לפי הדגלים, לא לפי השם. שינוי דגלים בסטטוס שכבר דווח יוצר גרסה חדשה מהיום והלאה${
              data.replaced ? ` (${data.replaced} גרסאות קודמות שמורות)` : ""
            }.`}
          >
            <StatusEditor roundId={active.id} statuses={data.statuses} />
          </Panel>
        </>
      ) : null}

      {others.length || active ? (
        <Panel title="סבבים נוספים">
          {others.map((r) => (
            <details key={r.id} className="border-b border-separator">
              <summary className="cursor-pointer px-4 py-3">
                {r.name} · {fmtDay(r.startsOn)}–{fmtDay(r.endsOn)}
              </summary>
              <RoundForm round={{ ...r, active: false }} />
            </details>
          ))}
          {active ? (
            <details>
              <summary className="cursor-pointer px-4 py-3 font-semibold text-primary">סבב חדש</summary>
              <RoundForm round={null} />
            </details>
          ) : null}
        </Panel>
      ) : null}
    </div>
  );
}
