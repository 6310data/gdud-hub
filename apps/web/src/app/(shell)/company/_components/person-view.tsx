/**
 * The אני view: הציוד שלי, דוח 1 and הפרטים שלי. The soldier sees it on /company/me (with the edit
 * forms); a commander sees the same for a soldier they cover, read-only.
 */
import { Chip, Serial } from "@gdud/ui";
import { addDays, countDays, formatPhone, PROFILE_FIELD_LABEL, type ProfileField } from "@gdud/core";
import { Empty, Panel } from "@/components/page-parts";
import { StatusChip } from "@/app/(shell)/doch1/_components/status-chip";
import type { GearRow, GearSource, OpenChange, PersonDetails, RoundDays } from "@/lib/company/data";
import { fmtDay } from "@/lib/doch1/format";
import { fmtDate } from "@/lib/logistics/format";
import { ChangeForm, PhoneForm } from "./me-forms";

const SOURCE_LABEL: Record<GearSource, string> = { logistics: "לוגיסטיקה", kesher: "קשר", company: "חתום עליי בפלוגה" };
const SOURCES: GearSource[] = ["logistics", "kesher", "company"];
/** how many coming days the דוח 1 card lists */
const NEXT_DAYS = 6;

export function PersonView({
  details,
  gear,
  round,
  changes,
  today,
  editable,
  place,
}: {
  details: PersonDetails;
  gear: GearRow[];
  round: RoundDays | null;
  changes: OpenChange[];
  today: string;
  editable: boolean;
  place: string;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <GearCard gear={gear} editable={editable} />
      <div className="flex flex-col gap-5">
        <DaysCard round={round} today={today} />
        <DetailsCard details={details} changes={changes} editable={editable} place={place} />
      </div>
    </div>
  );
}

function GearCard({ gear, editable }: { gear: GearRow[]; editable: boolean }) {
  return (
    <Panel title={editable ? "הציוד שלי" : "ציוד"}>
      {gear.length === 0 ? (
        <Empty>אין ציוד חתום.</Empty>
      ) : (
        SOURCES.filter((src) => gear.some((g) => g.source === src)).map((src) => (
          <div key={src} className="border-b border-[var(--separator)] last:border-b-0">
            <div className="px-4 pb-1 pt-3 text-[13px] font-semibold text-ink-muted">{SOURCE_LABEL[src]}</div>
            {gear
              .filter((g) => g.source === src)
              .map((g, i) => (
                <div key={`${g.serial ?? g.item}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-semibold">
                      {g.item}
                      {g.qty > 1 ? <span className="tz-num"> × {g.qty}</span> : null}
                    </span>
                    <span className="tz-footnote truncate">
                      {g.serial ? <Serial>{g.serial}</Serial> : null}
                      {g.serial && g.since ? " · " : null}
                      {g.since ? `מ-${fmtDate(g.since)}` : null}
                    </span>
                  </span>
                  {g.withName ? <Chip tone="brigade">נמצא אצל {g.withName}</Chip> : null}
                  {g.detail ? <Chip tone="signed">{g.detail}</Chip> : null}
                </div>
              ))}
          </div>
        ))
      )}
    </Panel>
  );
}

function DaysCard({ round, today }: { round: RoundDays | null; today: string }) {
  if (!round) {
    return (
      <Panel title="דוח 1">
        <Empty>אין סבב פעיל.</Empty>
      </Panel>
    );
  }
  const byDay = new Map(round.days.map((d) => [d.day, d]));
  const counts = countDays(round.days, today);
  const next = Array.from({ length: NEXT_DAYS }, (_, i) => addDays(today, i + 1)).filter((d) => d <= round.endsOn);
  const todayRow = byDay.get(today);
  const tiles = [
    { label: "נוכח", value: counts.present },
    { label: "בית", value: counts.home },
    { label: "התארגנות", value: counts.org },
    { label: "אחר", value: counts.other },
  ];
  return (
    <Panel title={`דוח 1 · ${round.roundName}`}>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="font-semibold">היום</span>
        {round.days.length || today >= round.startsOn ? <StatusChip status={todayRow ? { name: todayRow.statusName, color: todayRow.color } : null} /> : null}
      </div>
      <div className="grid grid-cols-4 border-y border-[var(--separator)] text-center">
        {tiles.map((t) => (
          <div key={t.label} className="flex flex-col py-2.5">
            <span className="tz-num text-[20px] font-bold">{t.value}</span>
            <span className="tz-footnote">{t.label}</span>
          </div>
        ))}
      </div>
      <div className="px-4 pt-2 text-[13px] text-ink-muted">
        ימים בסבב עד היום{counts.planned ? ` · ${counts.planned} ימים מתוכננים` : ""}
      </div>
      {next.length ? (
        <div className="flex flex-col py-1">
          {next.map((day) => {
            const d = byDay.get(day);
            return (
              <div key={day} className="flex items-center justify-between gap-3 px-4 py-1.5">
                <span className="tz-num text-[14px]">{fmtDay(day)}</span>
                {d ? <StatusChip status={{ name: d.statusName, color: d.color }} /> : <span className="tz-footnote">לא מתוכנן</span>}
              </div>
            );
          })}
        </div>
      ) : null}
    </Panel>
  );
}

function DetailsCard({ details, changes, editable, place }: { details: PersonDetails; changes: OpenChange[]; editable: boolean; place: string }) {
  const pending = (field: ProfileField) => changes.find((c) => c.field === field);
  const fieldRow = (field: ProfileField, value: string | null) => {
    const open = pending(field);
    return (
      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="tz-footnote w-16 flex-none">{PROFILE_FIELD_LABEL[field]}</span>
          <span className="min-w-0 flex-1 truncate font-semibold">{value || "—"}</span>
          {open ? <Chip tone="brigade">ממתין לאישור: {open.newValue || "ללא"}</Chip> : null}
        </div>
        {editable ? <ChangeForm field={field} current={open ? (open.newValue ?? "") : (value ?? "")} /> : null}
      </div>
    );
  };
  return (
    <Panel title={editable ? "הפרטים שלי" : "פרטים"}>
      {fieldRow("full_name", details.fullName)}
      <div className="border-t border-[var(--separator)]">{fieldRow("role_title", details.roleTitle)}</div>
      <div className="flex flex-col gap-2 border-t border-[var(--separator)] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="tz-footnote w-16 flex-none">טלפון</span>
          <span className="tz-serial min-w-0 flex-1 truncate">{formatPhone(details.phone) || "—"}</span>
        </div>
        {editable ? <PhoneForm current={formatPhone(details.phone)} /> : null}
      </div>
      <div className="flex items-center gap-2 border-t border-[var(--separator)] px-4 py-3">
        <span className="tz-footnote w-16 flex-none">שיבוץ</span>
        <span className="min-w-0 flex-1 truncate">{place || "—"}</span>
      </div>
      {editable ? <p className="tz-footnote m-0 px-4 pb-3">הטלפון נשמר מיד. שינוי שם או תפקיד נשלח לאישור המפקד.</p> : null}
    </Panel>
  );
}
