import Link from "next/link";
import { Icon } from "@gdud/ui";
import { Empty, PageHeader, Panel, SmallTile } from "@/components/page-parts";
import { kesherAccess } from "@/lib/kesher/access";
import { requireModule } from "@/lib/session";
import { CompanyDot } from "../_components/ui";

export const metadata = { title: "הפקת דוחות" };

/**
 * הפקת דוחות: the brigade report (battalion-wide members) and a report per company (the companies
 * the user covers). Each opens as a page to print / save as PDF, or downloads as Excel.
 */
export default async function KesherReports() {
  const s = await requireModule("kesher");
  const access = kesherAccess(s);

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-[22px]">
      <PageHeader title="הפקת דוחות" sub="לכל דוח: תצוגה להדפסה או לשמירה כ־PDF, וקובץ Excel עם אותן טבלאות." />

      {access.allCompanies ? (
        <Panel title="דוח לחטיבה">
          <ReportRow
            tile={<SmallTile color="var(--primary)" icon="report" />}
            title="דוח קשר גדודי לחטיבה"
            sub="המכשירים מטבלת הצ׳ בלבד, ממוינים לפי קטגוריה: כמה מכל סוג בכל מיקום, ופירוט כל מכשיר"
            query="r=brigade"
          />
        </Panel>
      ) : null}

      <Panel title="דוחות פלוגתיים">
        {access.companies.length ? (
          access.companies.map((c) => (
            <ReportRow
              key={c.id}
              tile={
                <span className="grid size-[30px] flex-none place-items-center rounded-tile bg-ground">
                  <CompanyDot color={c.color} />
                </span>
              }
              title={`רשימת ציוד · ${c.name}`}
              sub="הצ׳ של הפלוגה עם החתומים, ציוד משלים מול התקן, ושורת אישור לחתימה"
              query={`r=company&unit=${c.id}`}
            />
          ))
        ) : (
          <Empty>אין פלוגות בהרשאה שלך</Empty>
        )}
      </Panel>
    </div>
  );
}

function ReportRow({ tile, title, sub, query }: { tile: React.ReactNode; title: string; sub: string; query: string }) {
  return (
    <div className="tz-row">
      {tile}
      <span className="tz-row-body flex-wrap gap-y-2">
        <span className="tz-row-title text-[15px]">
          {title}
          <span className="tz-row-sub text-xs">{sub}</span>
        </span>
        <span className="flex flex-none items-center gap-2">
          <a href={`/kesher/reports/export?${query}`} className="tz-btn tz-btn-plain tz-btn-sm" download>
            <Icon name="table" size={15} />
            Excel
          </a>
          <Link href={`/kesher/reports/print?${query}`} className="tz-btn tz-btn-tinted tz-btn-sm">
            <Icon name="print" size={15} />
            הדפסה / PDF
          </Link>
        </span>
      </span>
    </div>
  );
}
