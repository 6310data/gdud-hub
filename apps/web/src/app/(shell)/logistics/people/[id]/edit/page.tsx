import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { withUser } from "@gdud/db";
import { Row, Section } from "@gdud/ui";
import { ActionButton } from "@/components/action-button";
import { logisticsAccess } from "@/lib/logistics/access";
import { loadPerson } from "@/lib/logistics/data";
import { requireModule } from "@/lib/session";
import { deactivatePerson } from "../../../_actions/people";
import { PageHeader } from "../../../_components/ui";
import { editableUnits, PersonForm } from "../../person-form";

export const metadata = { title: "עריכת חייל" };

export default async function EditPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const s = await requireModule("logistics");
  const access = logisticsAccess(s);
  const person = await withUser(s.claims, (tx) => loadPerson(tx, s.units, id));
  if (!person || !access.canEditPeople(person.unitId)) notFound();
  const units = editableUnits(s.units, access.canEditPeople);

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4">
      <Link href={`/logistics/people?person=${person.id}`} className="tz-btn tz-btn-plain self-start px-0">
        ‹ {person.name}
      </Link>
      <PageHeader title="עריכת חייל" sub="השינוי חל בכל המערכת (אלפון משותף)" />
      <div className="tz-card">
        <PersonForm person={person} units={units} />
      </div>
      {person.active ? (
        <Section footer="החייל יוסר מהאלפון הפעיל (ההיסטוריה נשמרת). אפשרי רק אם אין עליו ציוד מוחתם או באפסון.">
          <Row
            title="הסרה מהאלפון"
            trailing={<ActionButton action={deactivatePerson.bind(null, person.id)} label="הסרה" confirmLabel="לאשר הסרה" />}
          />
        </Section>
      ) : null}
    </div>
  );
}
