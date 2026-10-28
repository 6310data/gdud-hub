import { notFound } from "next/navigation";
import { desc, ne, schema, withUser } from "@gdud/db";
import { doch1Access } from "@/lib/doch1/access";
import { doch1Rounds } from "@/lib/doch1/rounds";
import { ROUND_STATE_LABEL } from "@/lib/doch1/format";
import { requireModule } from "@/lib/session";
import { RosterFlow } from "./_components/roster-flow";

export const metadata = { title: "דוח 1 · רשימת הגדוד" };

/** The battalion's soldier list for the round being planned: compare, decide, apply (battalion admin). */
export default async function Doch1Roster() {
  const s = await requireModule("doch1");
  if (!doch1Access(s).isAdmin) notFound();
  const { planning: round } = await doch1Rounds(s);
  const data = await withUser(s.claims, async (tx) => {
    const rounds = await tx
      .select({ id: schema.doch1Rounds.id, name: schema.doch1Rounds.name, state: schema.doch1Rounds.state })
      .from(schema.doch1Rounds)
      .where(ne(schema.doch1Rounds.state, "planning"))
      .orderBy(desc(schema.doch1Rounds.startsOn));
    return { round, rounds };
  });
  if (!data.round) notFound();

  return (
    <div className="flex w-full max-w-[960px] flex-col gap-[22px]">
      <div className="flex flex-col">
        <span className="tz-footnote">תכנון סבב · {data.round.name}</span>
        <h1 className="tz-title">רשימת הגדוד</h1>
        <span className="tz-footnote">משווים את רשימת החיילים מהגדוד לסבב הקודם, מחליטים על כל הבדל, ושולחים לגדוד קובץ תיקונים.</span>
      </div>
      <RosterFlow planningName={data.round.name} rounds={data.rounds.map((r) => ({ id: r.id, label: `${r.name} · ${ROUND_STATE_LABEL[r.state]}` }))} />
    </div>
  );
}
