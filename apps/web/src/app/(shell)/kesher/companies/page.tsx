import { redirect } from "next/navigation";
import { Empty, PageHeader } from "@/components/page-parts";
import { kesherAccess } from "@/lib/kesher/access";
import { requireModule } from "@/lib/session";

export const metadata = { title: "פלוגות" };

/** פלוגות opens on the user's (first) company. */
export default async function KesherCompanies() {
  const s = await requireModule("kesher");
  const first = kesherAccess(s).companies[0];
  if (first) redirect(`/kesher/companies/${first.id}`);
  return (
    <>
      <PageHeader title="פלוגות" />
      <div className="tz-card">
        <Empty>אין פלוגות בהרשאה שלך. פלוגות מוסיפים בניהול מערכת.</Empty>
      </div>
    </>
  );
}
