import { notFound } from "next/navigation";
import { z } from "zod";
import { eq, schema, withUser } from "@gdud/db";
import { Chip } from "@gdud/ui";
import { ActionButton } from "@/components/action-button";
import { PageHeader, Panel } from "@/components/page-parts";
import { requireCompanyScope } from "@/lib/company/access";
import { loadActivityCandidates, loadActivityPeople, loadActivityVehicles, loadCompanyVehicles, loadSoldierNames, timeRange } from "@/lib/company/data";
import { fmtDay } from "@/lib/doch1/format";
import { deleteActivity } from "../../../_actions/activities";
import { ActivityForm, ActivityVehicles, Participants } from "../../../_components/activity-forms";

export const metadata = { title: "פעילות" };

const { companyActivities: acts } = schema;
const paramsSchema = z.object({ unit: z.uuid(), id: z.uuid() });

/** One activity: its details (edit), who goes (with the דוח 1 check) and the company's vehicles on it. */
export default async function ActivityPage({ params }: { params: Promise<{ unit: string; id: string }> }) {
  const p = paramsSchema.safeParse(await params);
  if (!p.success) notFound();
  const { s, scope } = await requireCompanyScope(p.data.unit);
  const company = scope.company;
  const editable = scope.isAdmin || scope.platoons.length > 0;

  const data = await withUser(s.claims, async (tx) => {
    const [[activity], people, candidates, vehicles, chosen, soldiers] = await Promise.all([
      tx.select().from(acts).where(eq(acts.id, p.data.id)),
      loadActivityPeople(tx, p.data.id),
      editable ? loadActivityCandidates(tx, p.data.id) : Promise.resolve([]),
      loadCompanyVehicles(tx, company.id),
      loadActivityVehicles(tx, p.data.id),
      loadSoldierNames(tx, company.id),
    ]);
    return { activity, people, candidates, vehicles, chosen, soldiers };
  });
  const a = data.activity;
  if (!a || a.unitId !== company.id) notFound();
  const platoonName = (unitId: string) => s.units.find((u) => u.id === unitId && u.kind === "platoon")?.name ?? "מפקדה";
  const commander = data.soldiers.find((x) => x.id === a.commanderPersonId)?.name;
  const flagged = data.people.filter((x) => !x.qualifies).length;

  return (
    <>
      <PageHeader
        title={a.name}
        sub={[fmtDay(a.day), timeRange(a), a.place, commander ? `מפקד: ${commander}` : null].filter(Boolean).join(" · ")}
        actions={editable ? <ActionButton action={deleteActivity.bind(null, company.id, a.id)} label="מחיקה" confirmLabel="למחוק את הפעילות?" /> : null}
      />
      <Panel
        title={`מי יוצא (${data.people.length})`}
        action={flagged ? <Chip tone="broken">{flagged} לא נוכחים לפי דוח 1</Chip> : null}
      >
        <Participants
          unitId={company.id}
          activityId={a.id}
          editable={editable}
          people={data.people.map((x) => ({
            participantId: x.participantId,
            name: x.name,
            sub: platoonName(x.unitId),
            role: x.role,
            statusName: x.statusName,
            qualifies: x.qualifies,
            canRemove: x.canRemove,
          }))}
          candidates={data.candidates.map((x) => ({ id: x.id, name: x.name, personalNumber: null, place: `${platoonName(x.unitId)} · ${x.statusName}` }))}
        />
      </Panel>
      <Panel title="רכבים">
        <ActivityVehicles
          unitId={company.id}
          activityId={a.id}
          editable={editable}
          vehicles={data.vehicles.map((v) => ({ id: v.id, label: [v.number, v.kind].filter(Boolean).join(" · ") }))}
          chosen={data.chosen.map((v) => v.id)}
        />
      </Panel>
      {editable ? (
        <Panel title="פרטים">
          <ActivityForm
            unitId={company.id}
            soldiers={data.soldiers.map((x) => ({ id: x.id, name: x.name, personalNumber: null, place: platoonName(x.unitId) }))}
            values={{ id: a.id, name: a.name, day: a.day, startsAt: a.startsAt, endsAt: a.endsAt, place: a.place, commanderPersonId: a.commanderPersonId, notes: a.notes }}
          />
        </Panel>
      ) : a.notes ? (
        <Panel title="הערות">
          <p className="m-0 whitespace-pre-wrap p-4">{a.notes}</p>
        </Panel>
      ) : null}
    </>
  );
}
