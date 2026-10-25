import Link from "next/link";
import { VEHICLE_STATE_LABEL, type StatusDef } from "@gdud/core";
import { Avatar, Icon, Serial } from "@gdud/ui";
import type { TeamStatusVM } from "@/lib/doch1/standby";
import { StatusChip } from "../../_components/status-chip";

/** "2/3" chip: green when the team is full, orange otherwise (mockup 03). */
export function ReadyChip({ team }: { team: TeamStatusVM }) {
  const r = team.readiness;
  return (
    <span className={`tz-chip ${r.state === "full" ? "tz-chip-ok" : "tz-chip-broken"} min-w-11 justify-center`} title={`${r.available} זמינים מתוך ${r.total}`}>
      <span className="tz-num">
        {r.available}/{r.total}
      </span>
    </span>
  );
}

/** What is missing, in one line: "חסרים 2 · חסר טילן · הרכב בטיפול". Empty when the team is full. */
export function gapText(team: TeamStatusVM): string {
  const r = team.readiness;
  const parts: string[] = [];
  if (r.available < r.needed) parts.push(r.needed - r.available === 1 ? "חסר 1" : `חסרים ${r.needed - r.available}`);
  if (r.missingRoles.length) parts.push(`חסר ${r.missingRoles.join(", ")}`);
  if (!r.vehicleOk && team.vehicle) parts.push(`הרכב ${VEHICLE_STATE_LABEL[team.vehicle.state]}`);
  return parts.join(" · ");
}

/** A standby team (mockup 03): readiness, vehicle, members with today's status. */
export function TeamCard({
  team,
  statusOf,
  isAvailable,
  editable,
}: {
  team: TeamStatusVM;
  statusOf: (personId: string) => StatusDef | null;
  isAvailable: (personId: string) => boolean;
  editable: boolean;
}) {
  const gap = gapText(team);
  const full = team.readiness.state === "full";
  return (
    <article className="tz-group flex flex-col" style={team.active ? undefined : { opacity: 0.6 }}>
      <div className="flex items-center gap-3 px-4 pt-3.5 pb-2.5">
        <span className="tz-tile size-9 rounded-[9px]" style={{ background: full ? "var(--primary)" : "var(--tile-broken)" }}>
          <Icon name="shield" size={18} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="tz-headline truncate">{team.name}</span>
          <span className="tz-footnote truncate">
            {[team.holders || "ללא פלוגה מחזיקה", team.location?.name ?? "ללא מיקום", team.active ? null : "לא פעיל"].filter(Boolean).join(" · ")}
          </span>
        </span>
        <ReadyChip team={team} />
      </div>
      <div className="mx-4 flex items-center justify-between gap-2 rounded-[9px] bg-ground px-3 py-2">
        <span className="tz-footnote">רכב</span>
        {team.vehicle ? (
          <span className="flex items-center gap-2">
            {team.vehicle.state !== "ok" ? <span className="tz-chip tz-chip-broken">{VEHICLE_STATE_LABEL[team.vehicle.state]}</span> : null}
            <span className="text-[15px] font-semibold">
              צ׳ <Serial>{team.vehicle.number}</Serial>
            </span>
          </span>
        ) : (
          <span className="tz-footnote">לא שובץ</span>
        )}
      </div>
      <div className="pt-1.5 pb-1">
        {team.members.map((m) => {
          const away = !isAvailable(m.personId);
          return (
            <div
              key={m.personId}
              className="flex min-h-10 items-center gap-2.5 px-4 py-1"
              style={away ? { background: "var(--status-broken-soft)" } : undefined}
            >
              <Avatar name={m.name ?? "?"} size={28} />
              <span className="min-w-0 flex-1 truncate text-[15px]">
                {m.name ?? "חייל מפלוגה אחרת"}
                {m.role ? <span className="tz-footnote"> · {m.role}</span> : null}
              </span>
              {m.name ? <StatusChip status={statusOf(m.personId)} /> : null}
            </div>
          );
        })}
        {!team.members.length ? <p className="tz-footnote m-0 px-4 py-2">אין חיילים בצוות.</p> : null}
      </div>
      {gap || editable ? (
        <div className="flex items-center justify-between gap-2 border-t border-separator px-4 pt-2 pb-3">
          <span className="tz-footnote" style={gap ? { color: "var(--status-broken)" } : undefined}>
            {gap ? `${gap} · ${team.readiness.state === "short" ? "הצוות לא שלם היום" : "הצוות לא כשיר היום"}` : "הצוות שלם וכשיר"}
          </span>
          {editable ? (
            <Link href={`/doch1/standby/${team.id}`} className="tz-btn tz-btn-plain tz-btn-sm whitespace-nowrap">
              {gap ? "בחירת מחליף" : "עריכה"}
            </Link>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
