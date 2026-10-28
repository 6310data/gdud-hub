import { notFound } from "next/navigation";
import { z } from "zod";
import { israelToday, placement } from "@gdud/core";
import { withUser } from "@gdud/db";
import { ActionForm } from "@/components/action-form";
import { PageHeader, Panel } from "@/components/page-parts";
import { coversPerson, requireCompanyScope } from "@/lib/company/access";
import { loadDays, loadDetails, loadGear, loadOpenChanges, loadPersonActivities } from "@/lib/company/data";
import { linkAccount } from "../../../_actions/requests";
import { PersonView } from "../../../_components/person-view";

export const metadata = { title: "חייל" };

const paramsSchema = z.object({ unit: z.uuid(), personId: z.uuid() });

/** A soldier's אני view for a commander who covers them — read-only. */
export default async function SoldierPage({ params }: { params: Promise<{ unit: string; personId: string }> }) {
  const p = paramsSchema.safeParse(await params);
  if (!p.success) notFound();
  const { s, scope } = await requireCompanyScope(p.data.unit);
  const personId = p.data.personId;
  const today = israelToday(new Date());

  const { details, gear, round, changes, activities } = await withUser(s.claims, async (tx) => {
    const [details, gear, round, changes, activities] = await Promise.all([
      loadDetails(tx, personId),
      loadGear(tx, personId),
      loadDays(tx, personId),
      loadOpenChanges(tx, personId),
      loadPersonActivities(tx, personId),
    ]);
    return { details, gear, round, changes, activities };
  });
  // person_details returns nothing for a soldier the user doesn't cover
  if (!details || !coversPerson(scope, details.unitId, s.parents)) notFound();
  const { company, platoon } = placement(details.unitId, new Map(s.units.map((u) => [u.id, u])));
  const place = [company?.name, platoon?.name].filter(Boolean).join(" · ");

  return (
    <>
      <PageHeader title={details.fullName} sub={place} />
      <PersonView details={details} gear={gear} round={round} changes={changes} today={today} editable={false} place={place} activities={activities} />
      {scope.isAdmin && !details.linked ? (
        <Panel title="קישור חשבון">
          <p className="tz-footnote m-0 px-4 pt-3">
            לחייל אין חשבון במערכת. אם לא הצליח להצטרף לבד, כתבו את כתובת ה-Google שלו: בכניסה הבאה עם הכתובת הזו הוא יראה את הדף שלו.
          </p>
          <ActionForm action={linkAccount} submitLabel="קישור" variant="tinted" className="flex flex-wrap items-start gap-2 p-4" submitClassName="flex-none">
            <input type="hidden" name="personId" value={details.id} />
            <input name="email" type="email" className="tz-input min-w-[220px] flex-1" dir="ltr" required maxLength={320} aria-label="כתובת Google" placeholder="name@gmail.com" />
          </ActionForm>
        </Panel>
      ) : null}
    </>
  );
}
