"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { swapCandidates, teamReadiness, VEHICLE_STATE_LABEL, VEHICLE_STATES, type Day, type StatusDef, type VehicleState } from "@gdud/core";
import { Avatar, Icon, Spinner } from "@gdud/ui";
import { setDayStatus } from "../../_actions/days";
import { addTeamMember, deleteTeam, removeTeamMember, setTeamHolder, setTeamVehicle, setVehicleState, swapTeamMember, updateTeam } from "../../_actions/standby";
import { StatusChip, StatusDot } from "../../_components/status-chip";
import { UndoToast } from "../../today/_components/undo-toast";
import type { StandbyTypeVM, VehicleVM } from "@/lib/doch1/standby";
import { StatusSheet } from "../../today/_components/status-sheet";

export interface EditorMember {
  personId: string;
  /** null = a soldier of a unit the user doesn't see */
  name: string | null;
  role: string | null;
  sub: string;
  statusId: string | null;
  yesterdayId: string | null;
  /** may change their status today (reports for them, day not locked) */
  canReport: boolean;
}

export interface CandidateVM {
  personId: string;
  name: string;
  role: string | null;
  sub: string;
  onTeam: boolean;
  statusId: string | null;
}

type Option = { id: string; name: string };
type Undo = { message: string; run: () => Promise<{ error?: string } | undefined> };
type Sheet = { mode: "status"; member: EditorMember } | { mode: "swap"; member: EditorMember } | { mode: "add" } | null;

export function TeamEditor({
  dayLabel,
  today,
  lockAt,
  writableToday,
  isAdmin,
  team,
  vehicle,
  members,
  candidates,
  statuses,
  available: availableIds,
  types,
  locations,
  companies,
}: {
  dayLabel: string;
  today: Day;
  lockAt: string;
  writableToday: boolean;
  isAdmin: boolean;
  team: { id: string; name: string; active: boolean; typeId: string | null; locationId: string | null; holderIds: string[]; holders: string };
  vehicle: VehicleVM | null;
  members: EditorMember[];
  candidates: CandidateVM[];
  /** every status of the round (chips); the picker shows the active ones */
  statuses: StatusDef[];
  available: string[];
  types: StandbyTypeVM[];
  locations: Option[];
  companies: Option[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [toast, setToast] = useState<Undo | null>(null);
  const [number, setNumber] = useState(vehicle?.number ?? "");
  const [name, setName] = useState(team.name);

  const byId = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);
  const active = useMemo(() => statuses.filter((s) => s.active), [statuses]);
  const available = useMemo(() => new Set(availableIds), [availableIds]);
  const day = useMemo(() => new Map([...members, ...candidates].filter((m) => m.statusId).map((m) => [m.personId, m.statusId!])), [members, candidates]);
  const type = types.find((t) => t.id === team.typeId) ?? null;
  const readiness = teamReadiness({
    members,
    size: type?.size ?? null,
    requiredRoles: type?.requiredRoles ?? [],
    vehicleState: vehicle?.state ?? null,
    day,
    available,
  });
  const isAway = (personId: string) => !available.has(day.get(personId) ?? "");
  const full = readiness.state === "full";

  /** Runs a server action; `undo` (if returned) becomes the toast. */
  function act(fn: () => Promise<{ error?: string; undo?: Undo } | undefined>, after?: () => void) {
    setError(undefined);
    start(async () => {
      const r = await fn();
      if (r?.error) setError(r.error);
      else {
        if (r?.undo) setToast(r.undo);
        after?.();
      }
    });
  }

  const pickStatus = (m: EditorMember, statusId: string | null) => {
    setSheet(null);
    act(async () => {
      const r = await setDayStatus({ personId: m.personId, day: today, statusId });
      if (r?.error) return r;
      const label = statusId ? (byId.get(statusId)?.name ?? "") : "ללא סטטוס";
      return { undo: { message: `הסטטוס של ${m.name} עודכן ל${label}`, run: () => setDayStatus({ personId: m.personId, day: today, statusId: m.statusId }) } };
    });
  };

  const swap = (m: EditorMember, c: CandidateVM) => {
    setSheet(null);
    act(async () => {
      const r = await swapTeamMember({ teamId: team.id, outId: m.personId, inId: c.personId });
      if (r.error !== undefined) return r;
      return { undo: { message: `${m.name ?? "החייל"} הוחלף ב${c.name}`, run: () => swapTeamMember({ teamId: team.id, ...r.data.undo }) } };
    });
  };

  const add = (c: CandidateVM) => {
    setSheet(null);
    act(async () => {
      const r = await addTeamMember({ teamId: team.id, personId: c.personId });
      if (r?.error) return r;
      return { undo: { message: `${c.name} נוסף לצוות`, run: async () => removeTeamMember({ teamId: team.id, personId: c.personId }) } };
    });
  };

  const remove = (m: EditorMember) =>
    act(async () => {
      const r = await removeTeamMember({ teamId: team.id, personId: m.personId });
      if (r.error !== undefined) return r;
      const slot = r.data.undo;
      return { undo: { message: `${m.name ?? "החייל"} הוסר מהצוות`, run: () => addTeamMember({ teamId: team.id, ...slot }) } };
    });

  const undo = () => {
    if (!toast) return;
    const { run } = toast;
    act(async () => {
      const r = await run();
      setToast(null);
      return r?.error ? r : undefined;
    });
  };

  const hideToast = useCallback(() => setToast(null), []);
  const closeSheet = useCallback(() => setSheet(null), []);

  const missing = readiness.needed - readiness.available;
  const bannerTitle = full ? "הצוות שלם וכשיר" : missing > 0 ? (missing === 1 ? "חסר 1 בצוות היום" : `חסרים ${missing} בצוות היום`) : readiness.missingRoles.length ? `חסר ${readiness.missingRoles.join(", ")}` : "הרכב לא כשיר";
  const bannerSub = [vehicle ? `צ׳ ${vehicle.number} · ${VEHICLE_STATE_LABEL[vehicle.state]}` : "ללא רכב", `${readiness.available} מתוך ${readiness.total} זמינים`, readiness.missingRoles.length && missing > 0 ? `חסר ${readiness.missingRoles.join(", ")}` : null]
    .filter(Boolean)
    .join(" · ");
  const sheetMember = sheet && sheet.mode !== "add" ? sheet.member : null;
  const pool = swapCandidates(sheet?.mode === "swap" ? sheet.member.role : null, candidates, day, available);
  const roleNote = type
    ? [type.requiredRoles.length ? `תפקידי חובה ל${type.name}: ${type.requiredRoles.join(", ")}` : null, type.size ? `גודל: ${type.size}` : null].filter(Boolean).join(". ")
    : "לצוות אין סוג כוננות, אז אין גודל ותפקידי חובה.";

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-1.5 pb-20">
      <div className="flex items-center justify-between gap-2">
        <Link href="/doch1/standby" className="tz-btn tz-btn-plain px-0">
          <Icon name="chevron" size={17} className="rotate-180" />
          שבצ״ק וכוננות
        </Link>
        {pending ? <Spinner size={16} label="שומר" /> : null}
      </div>
      <span className="tz-footnote">
        {team.holders || "ללא פלוגה מחזיקה"} · {dayLabel}
      </span>
      <h1 className="tz-large-title pb-2">{team.name}</h1>

      <div className="flex items-center gap-3 rounded-group px-3.5 py-3" style={{ background: full ? "var(--status-ok-soft)" : "var(--status-broken-soft)" }}>
        <span className="tz-tile size-[34px]" style={{ background: full ? "var(--tile-ok)" : "var(--tile-broken)" }}>
          <Icon name={full ? "check" : "alert"} size={18} />
        </span>
        <span className="flex flex-1 flex-col">
          <span className="text-[16px] font-semibold" style={{ color: full ? "var(--status-ok)" : "var(--status-broken)" }}>
            {bannerTitle}
          </span>
          <span className="tz-footnote">{bannerSub}</span>
        </span>
      </div>

      {error ? (
        <p role="alert" className="tz-alert tz-alert-error m-0 mt-2">
          {error}
        </p>
      ) : null}

      <h2 className="tz-section-header pt-5">רכב</h2>
      <div className="tz-group">
        <form
          className="tz-row"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => setTeamVehicle({ teamId: team.id, number }));
          }}
        >
          <span className="tz-row-body">
            <label htmlFor="veh" className="tz-row-title">
              צ׳ רכב
            </label>
            <input
              id="veh"
              className="tz-input tz-serial min-h-9 w-[130px] text-left font-semibold"
              inputMode="numeric"
              dir="ltr"
              value={number}
              maxLength={20}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="ללא"
            />
            {number.trim() !== (vehicle?.number ?? "") ? (
              <button type="submit" className="tz-btn tz-btn-tinted tz-btn-sm" disabled={pending}>
                שמירה
              </button>
            ) : null}
          </span>
        </form>
        {vehicle ? (
          <div className="tz-row">
            <span className="tz-row-body flex-wrap gap-y-2 py-2">
              <span className="tz-row-title">מצב הרכב</span>
              <span className="tz-seg w-[210px]" role="tablist" aria-label="מצב הרכב">
                {VEHICLE_STATES.map((st: VehicleState) => (
                  <button
                    key={st}
                    type="button"
                    role="tab"
                    className="tz-seg-item"
                    aria-selected={vehicle.state === st}
                    disabled={pending}
                    onClick={() => vehicle.state !== st && act(() => setVehicleState({ vehicleId: vehicle.id, state: st }))}
                  >
                    {VEHICLE_STATE_LABEL[st]}
                  </button>
                ))}
              </span>
            </span>
          </div>
        ) : null}
        <label className="tz-row">
          <span className="tz-row-body">
            <span className="tz-row-title">מיקום</span>
            <select
              className="tz-input min-h-9 w-auto max-w-[180px]"
              value={team.locationId ?? ""}
              disabled={pending}
              onChange={(e) => act(() => updateTeam({ teamId: team.id, locationId: e.target.value || null }))}
            >
              <option value="">ללא</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </span>
        </label>
      </div>

      <h2 className="tz-section-header pt-5">
        חיילים בצוות · {readiness.available}/{readiness.total} זמינים
      </h2>
      <div className="tz-group">
        {members.map((m) => {
          const away = isAway(m.personId);
          const st = byId.get(m.statusId ?? "") ?? null;
          return (
            <div key={m.personId} className="tz-row" style={away ? { background: "var(--status-broken-soft)" } : undefined}>
              <Avatar name={m.name ?? "?"} />
              <span className="tz-row-body gap-1.5">
                <span className="tz-row-title">
                  {m.name ?? "חייל מפלוגה אחרת"}
                  <span className="tz-row-sub">{[m.role, m.sub].filter(Boolean).join(" · ")}</span>
                </span>
                {m.name ? (
                  m.canReport ? (
                    <button type="button" className="border-0 bg-transparent p-0" aria-label={`שינוי סטטוס של ${m.name}`} disabled={pending} onClick={() => setSheet({ mode: "status", member: m })}>
                      <StatusChip status={st} />
                    </button>
                  ) : (
                    <StatusChip status={st} />
                  )
                ) : null}
                {away && candidates.length ? (
                  <button type="button" className="tz-btn tz-btn-plain tz-btn-sm px-1 font-semibold" disabled={pending} onClick={() => setSheet({ mode: "swap", member: m })}>
                    החלפה
                  </button>
                ) : null}
                <button type="button" className="tz-icon-btn" aria-label={`הסרת ${m.name ?? "החייל"} מהצוות`} disabled={pending} onClick={() => remove(m)}>
                  <Icon name="minus" size={17} />
                </button>
              </span>
            </div>
          );
        })}
        <button type="button" className="tz-row w-full text-start" disabled={pending || !candidates.length} onClick={() => setSheet({ mode: "add" })}>
          <span className="tz-row-body">
            <span className="tz-row-title text-primary">{candidates.length ? "הוספת חייל לצוות" : "אין חיילים פנויים להוספה"}</span>
          </span>
        </button>
      </div>
      <p className="tz-section-footer">
        {roleNote} {writableToday ? "שינוי בסטטוס כאן מעדכן גם את דוח 1 של היום." : `דוח 1 של היום ננעל ב-${lockAt}, אז הסטטוסים כאן לקריאה בלבד.`}
      </p>

      <h2 className="tz-section-header pt-5">הכוננות</h2>
      <div className="tz-group">
        <form
          className="tz-row"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => updateTeam({ teamId: team.id, name }));
          }}
        >
          <span className="tz-row-body">
            <label htmlFor="team-name" className="tz-row-title">
              שם הצוות
            </label>
            <input id="team-name" className="tz-input min-h-9 w-[180px]" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            {name.trim() && name.trim() !== team.name ? (
              <button type="submit" className="tz-btn tz-btn-tinted tz-btn-sm" disabled={pending}>
                שמירה
              </button>
            ) : null}
          </span>
        </form>
        <label className="tz-row">
          <span className="tz-row-body">
            <span className="tz-row-title">סוג כוננות</span>
            <select
              className="tz-input min-h-9 w-auto max-w-[180px]"
              value={team.typeId ?? ""}
              disabled={pending}
              onChange={(e) => act(() => updateTeam({ teamId: team.id, typeId: e.target.value || null }))}
            >
              <option value="">ללא</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </span>
        </label>
        <label className="tz-row">
          <span className="tz-row-body">
            <span className="tz-row-title">
              צוות פעיל
              <span className="tz-row-sub">צוות לא פעיל לא נספר בכוננות</span>
            </span>
            <input type="checkbox" role="switch" checked={team.active} disabled={pending} onChange={(e) => act(() => updateTeam({ teamId: team.id, active: e.target.checked }))} />
          </span>
        </label>
      </div>

      {isAdmin ? (
        <>
          <h2 className="tz-section-header pt-5">פלוגות מחזיקות</h2>
          <div className="tz-group">
            {companies.map((c) => (
              <label key={c.id} className="tz-row">
                <span className="tz-row-body">
                  <span className="tz-row-title">{c.name}</span>
                  <input
                    type="checkbox"
                    checked={team.holderIds.includes(c.id)}
                    disabled={pending}
                    onChange={(e) => act(() => setTeamHolder({ teamId: team.id, unitId: c.id, add: e.target.checked }))}
                  />
                </span>
              </label>
            ))}
          </div>
          <p className="tz-section-footer">משתמשי הפלוגות המחזיקות עורכים את הצוות ומוסיפים לו חיילים שלהם.</p>
        </>
      ) : null}

      <div className="pt-6">
        <button
          type="button"
          className="tz-btn tz-btn-danger tz-btn-sm"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(`למחוק את הצוות ״${team.name}״? החיילים יוצאו מהכוננות.`)) return;
            act(
              () => deleteTeam({ teamId: team.id }),
              () => router.push("/doch1/standby"),
            );
          }}
        >
          מחיקת הצוות
        </button>
      </div>

      {sheet?.mode === "status" && sheetMember ? (
        <StatusSheet
          name={sheetMember.name ?? ""}
          title="סטטוס להיום"
          yesterday={byId.get(sheetMember.yesterdayId ?? "")?.name ?? null}
          current={sheetMember.statusId}
          statuses={active}
          onPick={(id) => pickStatus(sheetMember, id)}
          onClose={closeSheet}
        />
      ) : null}
      {sheet && sheet.mode !== "status" ? (
        <CandidatesSheet
          title={sheet.mode === "swap" ? `מחליף ל${sheet.member.name ?? "החייל"}` : "הוספת חייל לצוות"}
          sub={sheet.mode === "swap" ? "זמינים היום קודם, אותו תפקיד קודם" : "חיילי הפלוגה שאינם בכוננות, זמינים קודם"}
          candidates={pool}
          statusOf={(id) => byId.get(day.get(id) ?? "") ?? null}
          onPick={(c) => (sheet.mode === "swap" ? swap(sheet.member, c) : add(c))}
          onClose={closeSheet}
        />
      ) : null}
      {toast ? <UndoToast message={toast.message} onUndo={undo} onDone={hideToast} pending={pending} /> : null}
    </div>
  );
}

function CandidatesSheet({
  title,
  sub,
  candidates,
  statusOf,
  onPick,
  onClose,
}: {
  title: string;
  sub: string;
  candidates: Array<CandidateVM & { available: boolean; sameRole: boolean }>;
  statusOf: (personId: string) => StatusDef | null;
  onPick: (c: CandidateVM) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const q = query.trim();
  const list = candidates.filter((c) => !q || c.name.includes(q) || (c.role ?? "").includes(q) || c.sub.includes(q));

  return (
    <>
      <button type="button" className="tz-scrim" aria-label="סגירה" onClick={onClose} />
      <div className="tz-sheet flex max-h-[85vh] flex-col" role="dialog" aria-modal="true" aria-label={title}>
        <div className="tz-grabber" />
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-2 pb-1">
          <button type="button" className="tz-btn tz-btn-plain justify-self-start" onClick={onClose}>
            ביטול
          </button>
          <span className="tz-headline">{title}</span>
          <span />
        </div>
        <p className="tz-footnote m-0 pb-3 text-center">{sub}</p>
        <label className="tz-search mx-4 mb-3">
          <Icon name="search" size={15} />
          <input type="search" placeholder="חיפוש" aria-label="חיפוש" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        </label>
        <div className="tz-group mx-4 min-h-0 overflow-y-auto">
          {list.map((c) => (
            <button
              key={c.personId}
              type="button"
              className="tz-row w-full text-start"
              disabled={!c.available}
              style={c.available ? undefined : { opacity: 0.45 }}
              onClick={() => onPick(c)}
            >
              <Avatar name={c.name} />
              <span className="tz-row-body">
                <span className="tz-row-title">
                  {c.name}
                  <span className="tz-row-sub">{[c.role, c.sub, c.available ? null : "לא זמין היום"].filter(Boolean).join(" · ")}</span>
                </span>
                {statusOf(c.personId) ? <StatusChip status={statusOf(c.personId)} /> : <StatusDot color="var(--line-strong)" />}
              </span>
            </button>
          ))}
          {!list.length ? <p className="tz-footnote m-0 p-4 text-center">אין חיילים פנויים.</p> : null}
        </div>
      </div>
    </>
  );
}
