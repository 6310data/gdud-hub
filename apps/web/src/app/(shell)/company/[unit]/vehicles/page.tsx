import { z } from "zod";
import { withUser } from "@gdud/db";
import { Empty, PageHeader, Panel } from "@/components/page-parts";
import { requireCompanyScope } from "@/lib/company/access";
import { loadVehicleCards, loadVehicleOptions } from "@/lib/company/data";
import { VehicleCard } from "../../_components/vehicle-card";
import { CompanyPills } from "../../_components/ui";

export const metadata = { title: "רכבים" };

const paramsSchema = z.object({ unit: z.uuid() });

/**
 * רכבים: each of the company's vehicles (assigned in דוח 1) with the kesher צ׳ mounted on it, its ציוד
 * משלים and the standby team that uses it. The company admin edits the kesher gear with kesher's rules;
 * every change shows in kesher's יומן.
 */
export default async function VehiclesPage({ params }: { params: Promise<{ unit: string }> }) {
  const p = paramsSchema.safeParse(await params);
  const { s, access, scope } = await requireCompanyScope(p.success ? p.data.unit : "");
  const company = scope.company;
  const { cards, options } = await withUser(s.claims, async (tx) => {
    const [cards, options] = await Promise.all([loadVehicleCards(tx, company.id), scope.isAdmin ? loadVehicleOptions(tx, company.id) : Promise.resolve(null)]);
    return { cards, options };
  });

  return (
    <>
      <CompanyPills companies={access.companies} current={company.id} path="/vehicles" />
      <PageHeader
        title="רכבים"
        sub={`${company.name} · הרכבים של הפלוגה, ציוד הקשר עליהם והכוננות שמשתמשת בהם.${scope.isAdmin ? " כל שינוי בציוד נרשם ביומן של מחלקת הקשר." : ""}`}
      />
      {cards.length === 0 ? (
        <Panel>
          <Empty>אין לפלוגה רכבים. מנהל דוח 1 משייך רכבים לפלוגה, ורכב חדש שמוסיפים לצוות כוננות של הפלוגה הוא שלה.</Empty>
        </Panel>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] items-start gap-4">
          {cards.map((v) => (
            <VehicleCard key={v.id} unitId={company.id} vehicle={v} options={options} />
          ))}
        </div>
      )}
    </>
  );
}
