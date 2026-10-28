import Link from "next/link";
import { israelToday, placement } from "@gdud/core";
import { withUser } from "@gdud/db";
import { Empty, PageHeader, Panel } from "@/components/page-parts";
import { PushToggle } from "@/app/(shell)/doch1/_components/push-toggle";
import { requireCompany } from "@/lib/company/access";
import { loadDays, loadDetails, loadGear, loadOpenChanges, loadPersonActivities } from "@/lib/company/data";
import { PersonView } from "../_components/person-view";

export const metadata = { title: "אני" };

/** אני: what is signed on me, my דוח 1 status and days, and my details. Only my own rows. */
export default async function MePage() {
  const { s, access } = await requireCompany();
  const personId = access.personId;
  if (!personId) {
    return (
      <>
        <PageHeader title="אני" />
        <Panel>
          <Empty>
            החשבון לא מקושר לחייל. <Link href="/join">קישור החשבון לפרטים שלי</Link>
          </Empty>
        </Panel>
      </>
    );
  }

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
  if (!details) return <Empty>החייל לא נמצא.</Empty>;
  const byId = new Map(s.units.map((u) => [u.id, u]));
  const { company, platoon } = placement(details.unitId, byId);

  return (
    <>
      <PageHeader title={details.fullName} sub={[company?.name, platoon?.name].filter(Boolean).join(" · ")} actions={<PushToggle />} />
      <PersonView
        details={details}
        gear={gear}
        round={round}
        changes={changes}
        today={today}
        editable
        activities={activities}
        place={[company?.name, platoon?.name].filter(Boolean).join(" · ")}
      />
    </>
  );
}
