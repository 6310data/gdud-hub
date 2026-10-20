import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { logisticsAccess } from "@/lib/logistics/access";
import { requireModule } from "@/lib/session";
import { PageHeader } from "../../_components/ui";
import { editableUnits, PersonForm } from "../person-form";

export const metadata = { title: "חייל חדש" };

export default async function NewPersonPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requireModule("logistics");
  const access = logisticsAccess(s);
  const units = editableUnits(s.units, access.canEditPeople);
  if (!units.length) notFound();
  const { unit } = z.object({ unit: z.uuid().optional().catch(undefined) }).parse(await searchParams);

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4">
      <Link href={unit ? `/logistics/people?unit=${unit}` : "/logistics/people"} className="tz-btn tz-btn-plain self-start px-0">
        ‹ פלוגות ואלפון
      </Link>
      <PageHeader title="חייל חדש" sub="החייל יתווסף לאלפון הגדודי, המשותף לכל המחלקות" />
      <div className="tz-card">
        <PersonForm units={units} defaultUnitId={units.some((u) => u.id === unit) ? unit : undefined} />
      </div>
    </div>
  );
}
