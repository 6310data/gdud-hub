import Link from "next/link";
import { dayRange, hebrewDayLabel } from "@gdud/core";
import { Icon } from "@gdud/ui";
import { dayHref } from "@/lib/doch1/format";
import type { ReportsData } from "@/lib/doch1/reports";
import { DayNav } from "../../_components/day-nav";
import {
  CampList,
  ControlTable,
  CriticalRolesTable,
  DataChecks,
  Empty,
  ListedList,
  OutpostTable,
  ReportSection,
  SadakByPlatoon,
  SummaryCards,
} from "./report-tables";

/** The reports screen (mockup 04). Presentational: the page loads and counts. */
export function ReportsView({ data, isAdmin, isMaster, clock }: { data: ReportsData; isAdmin: boolean; isMaster: boolean; clock: string }) {
  const { day, today, round, reports: r } = data;
  const dayParam = day === today ? null : day;
  const back = dayHref("/doch1/reports", {}, dayParam);
  const roundDay = dayRange(round.startsOn, day).length;
  const dateLine = [
    `${hebrewDayLabel(day)}.${day.slice(0, 4)}`,
    roundDay > 0 ? `יום ${roundDay} בסבב` : null,
    day > today ? "תכנון" : null,
    `נכון ל־${clock}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const needsOutpost = [...new Set(data.statuses.filter((st) => st.active && st.needsOutpost).map((st) => st.name))].join(" / ") || "דורש מוצב";
  const listedNames = r.categories.filter((c) => c.listed).map((c) => c.name);
  const listedLabel = listedNames.length ? listedNames.join(" / ") : null;
  const camps = r.outposts.camps;
  const outposts = r.outposts.outposts;
  const hints = [
    !data.configured.categories ? "עמודות הדמ״ח נלקחו מהנתונים (הנפוצות קודם)" : null,
    !data.configured.camps ? "אין סטטוס שמשויך למחנה, ולכן שורות המחנה ריקות" : null,
    !data.configured.groups && camps.length ? "10א מוצג לפי פלוגה" : null,
  ].filter((x): x is string => !!x);

  const jumps = [
    { id: "r1", label: "לפי מסגרת ומיקום" },
    { id: "r2", label: "15א" },
    ...(camps.length ? [{ id: "r3", label: "10א" }] : []),
    ...(listedLabel ? [{ id: "r4", label: listedLabel }] : []),
    { id: "r5", label: "בקרת נתונים" },
    { id: "r6", label: "סד״כ לפי מסגרת" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="tz-footnote">{dateLine}</span>
          <h1 className="tz-large-title">דוחות</h1>
          <span className="tz-footnote">נבנים מדוח 1 ומהשבצ״ק{data.companies.length === 1 ? ` · ${data.companies[0]!.name}` : ""}</span>
          <DayNav day={day} today={today} min={round.startsOn} max={round.endsOn} path="/doch1/reports" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={dayHref("/doch1/reports/export", {}, dayParam)} className="tz-btn tz-btn-tinted min-h-10 text-[15px]" download>
            <Icon name="table" size={17} />
            ייצוא לאקסל
          </a>
          {isAdmin ? (
            <Link href={dayHref("/doch1/brigade", {}, dayParam)} className="tz-btn tz-btn-filled min-h-10 text-[15px] max-lg:hidden">
              <Icon name="send" size={17} />
              שליחה לחטיבה
            </Link>
          ) : null}
        </div>
      </header>

      <nav aria-label="קפיצה לדוח" className="tz-pills">
        {jumps.map((j) => (
          <a key={j.id} href={`#${j.id}`} className="tz-pill">
            {j.label}
          </a>
        ))}
      </nav>

      <SummaryCards summary={r.summary} outposts={outposts} listedLabel={listedLabel} />

      {hints.length ? (
        <p className="tz-callout m-0 text-[14px]">
          {hints.join(" · ")}.{" "}
          {isMaster ? (
            <Link href="/doch1/settings#reports" className="font-semibold text-primary">
              הגדרות › דוחות
            </Link>
          ) : null}
        </p>
      ) : null}

      <ReportSection id="r1" title="דוח 1 · לפי מסגרת ומיקום" note="מוצב לפי השבצ״ק · מחנה לפי הסטטוס · שורות ריקות מוסתרות">
        <CriticalRolesTable data={r.criticalRoles} companies={data.companies} locations={data.locations} />
      </ReportSection>

      <div className="flex flex-wrap items-start gap-[22px]">
        <ReportSection
          id="r2"
          title={`15א · ${needsOutpost} לפי מוצב`}
          note="סד״כ שמ״פ"
          className="flex-[3_1_520px]"
          footer={`שורה מסומנת: דיווחו ${needsOutpost} בדוח 1 אבל אין להם מוצב בשבצ״ק.`}
        >
          <OutpostTable data={r.outposts} companies={data.companies} needsOutpostLabel={needsOutpost} />
        </ReportSection>
        {r.camps.map((c, i) => (
          <ReportSection key={c.location.id} id={i === 0 ? "r3" : `r3-${i}`} title={`10א · ${c.location.name}`} note={`${c.total.toLocaleString("he-IL")} בסה״כ`} className="flex-[2_1_340px]">
            <CampList data={c} />
          </ReportSection>
        ))}
      </div>

      <div className="flex flex-wrap items-start gap-[22px]">
        {listedLabel ? (
          <ReportSection
            id="r4"
            title={listedLabel}
            note={`${r.summary.listedAvailable} זמינים מתוך ${r.summary.listedTotal}`}
            className="flex-[2_1_340px]"
          >
            <ListedList rows={r.listed} people={data.people} statuses={data.statuses} back={back} />
          </ReportSection>
        ) : null}
        <ReportSection id="r5" title="בקרת נתונים" note="דוח 1 מול השבצ״ק" className="flex-[3_1_560px]" footer="כל ערך אדום מוביל לרשימת החיילים שגורמים לפער.">
          {data.companies.length ? <ControlTable rows={r.control} companies={data.companies} /> : <Empty>אין פלוגות פעילות בסבב.</Empty>}
        </ReportSection>
      </div>

      <ReportSection id="checks" title="בדיקות נתונים" note="לחיצה על חייל פותחת את הכרטיס שלו">
        <DataChecks checks={r.checks} people={data.people} statuses={data.statuses} dayStatuses={data.dayStatuses} back={back} />
      </ReportSection>

      <ReportSection id="r6" title="סד״כ לפי מסגרת" note={`${needsOutpost} לפי מוצב בשבצ״ק · סטטוס שאינו בשמ״פ לא נספר בעמודה`}>
        {r.sadak.rows.length ? <SadakByPlatoon data={r.sadak} companies={data.companies} platoonNames={data.platoonNames} /> : <Empty>אין חיילים ברשימה ביום הזה.</Empty>}
      </ReportSection>
    </div>
  );
}
