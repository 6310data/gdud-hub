"use client";
import { useEffect, useOptimistic, useState, useTransition } from "react";
import type { LocationKind, StatusDef } from "@gdud/core";
import { Avatar, Icon, Spinner } from "@gdud/ui";
import { setMembersLocation } from "../../_actions/standby";
import { StatusChip } from "../../_components/status-chip";

export interface LocatedMemberVM {
  personId: string;
  name: string;
  /** "מחלקה 1 · נגביסט" */
  sub: string;
  companyName: string;
  inReport: boolean;
  locationId: string | null;
  /** the standby team they are on */
  team: string | null;
  status: StatusDef | null;
  /** the user may set this soldier's location */
  editable: boolean;
}

type Loc = { id: string; name: string; kind: LocationKind };

/** Filter ids: "all", "unplaced", "no-outpost", "other-status", "loc:<id>" (links from the teams view use the same ids). */
type Filter = string;

/** מיקומים בשבצ״ק (mockup 11, "מיקומים"): every soldier's location, the two status checks, and setting locations. */
export function LocationsBoard({
  members: serverMembers,
  locations,
  checks,
  initialFilter,
  showCompany,
}: {
  members: LocatedMemberVM[];
  locations: Loc[];
  checks: { noOutpost: string[]; otherStatus: string[] };
  initialFilter: Filter;
  showCompany: boolean;
}) {
  const [members, optimistic] = useOptimistic(serverMembers, (list, c: { personIds: string[]; locationId: string | null }) =>
    list.map((m) => (c.personIds.includes(m.personId) ? { ...m, locationId: c.locationId } : m)),
  );
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [sheetFor, setSheetFor] = useState<string[] | null>(null);

  const counted = members.filter((m) => m.inReport);
  const noOutpost = new Set(checks.noOutpost);
  const otherStatus = new Set(checks.otherStatus);
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const filters: Array<[Filter, string, number]> = [
    ["all", "הכל", counted.length],
    ...locations.map((l): [Filter, string, number] => [`loc:${l.id}`, l.name, counted.filter((m) => m.locationId === l.id).length]),
    ["unplaced", "לא בשבצ״ק", counted.filter((m) => !m.locationId).length],
    ["no-outpost", "סטטוס מוצב בלי מוצב", checks.noOutpost.length],
    ["other-status", "במוצב בסטטוס אחר", checks.otherStatus.length],
  ];

  const q = query.trim();
  const visible = counted.filter((m) => {
    if (q && !m.name.includes(q) && !m.sub.includes(q)) return false;
    if (filter === "unplaced") return !m.locationId;
    if (filter === "no-outpost") return noOutpost.has(m.personId);
    if (filter === "other-status") return otherStatus.has(m.personId);
    if (filter.startsWith("loc:")) return m.locationId === filter.slice(4);
    return true;
  });
  const editableVisible = visible.filter((m) => m.editable);

  function place(personIds: string[], locationId: string | null) {
    setSheetFor(null);
    setError(undefined);
    start(async () => {
      optimistic({ personIds, locationId });
      const r = await setMembersLocation({ personIds, locationId });
      if (r?.error) setError(r.error);
      else {
        setSelecting(false);
        setSelected(new Set());
      }
    });
  }

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-3 pb-16">
      <div className="tz-pills" role="toolbar" aria-label="סינון">
        {filters.map(([id, label, n]) => (
          <button key={id} type="button" className="tz-pill" aria-pressed={filter === id} onClick={() => setFilter(id)}>
            {label}
            <span className="tz-pill-count tz-num">{n}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <label className="tz-search flex-1">
          <Icon name="search" size={15} />
          <input type="search" placeholder="חיפוש חייל, מחלקה או תפקיד" aria-label="חיפוש" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {editableVisible.length ? (
          <button
            type="button"
            className="tz-btn tz-btn-plain"
            aria-pressed={selecting}
            onClick={() => {
              setSelecting((v) => !v);
              setSelected(new Set());
            }}
          >
            {selecting ? "סיום" : "בחירה"}
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="tz-alert tz-alert-error m-0">
          {error}
        </p>
      ) : null}

      <div className="tz-group">
        {visible.map((m) => {
          const body = (
            <>
              {selecting && m.editable ? (
                <input type="checkbox" className="self-center" checked={selected.has(m.personId)} readOnly tabIndex={-1} aria-hidden="true" />
              ) : null}
              <Avatar name={m.name} />
              <span className="tz-row-body flex-wrap gap-y-1 py-1.5">
                <span className="tz-row-title min-w-[150px]">
                  {m.name}
                  <span className="tz-row-sub">{[showCompany ? m.companyName : null, m.sub, m.team ? `כוננות: ${m.team}` : null].filter(Boolean).join(" · ")}</span>
                </span>
                <StatusChip status={m.status} />
                <span className={`tz-chip ${m.locationId ? "tz-chip-signed" : ""}`} style={m.locationId ? undefined : { background: "var(--danger-soft)", color: "var(--danger)" }}>
                  {m.locationId ? (locName.get(m.locationId) ?? "—") : "לא בשבצ״ק"}
                </span>
                {m.editable && !selecting ? <Icon name="chevron" size={17} className="tz-chevron" /> : null}
              </span>
            </>
          );
          return m.editable ? (
            <button
              key={m.personId}
              type="button"
              className="tz-row"
              aria-pressed={selecting ? selected.has(m.personId) : undefined}
              onClick={() => (selecting ? toggle(m.personId) : setSheetFor([m.personId]))}
            >
              {body}
            </button>
          ) : (
            <div key={m.personId} className="tz-row">
              {body}
            </div>
          );
        })}
        {!visible.length ? <p className="tz-footnote m-0 p-4 text-center">אין חיילים בסינון הזה.</p> : null}
      </div>

      {selecting ? (
        <div className="tz-action-bar lg:sticky lg:bottom-4 lg:rounded-group">
          <span className="text-[15px] font-semibold">{selected.size} נבחרו</span>
          <button
            type="button"
            className="tz-btn tz-btn-plain tz-btn-sm"
            onClick={() => setSelected(new Set(selected.size === editableVisible.length ? [] : editableVisible.map((m) => m.personId)))}
          >
            {selected.size === editableVisible.length ? "ניקוי" : "בחירת כל המוצגים"}
          </button>
          <button type="button" className="tz-btn tz-btn-filled tz-btn-sm ms-auto" disabled={!selected.size || pending} onClick={() => setSheetFor([...selected])}>
            {pending ? <Spinner size={14} /> : null}
            קביעת מיקום
          </button>
        </div>
      ) : null}

      {sheetFor ? (
        <LocationSheet
          title={sheetFor.length === 1 ? (members.find((m) => m.personId === sheetFor[0])?.name ?? "") : `${sheetFor.length} חיילים`}
          current={sheetFor.length === 1 ? (members.find((m) => m.personId === sheetFor[0])?.locationId ?? null) : undefined}
          locations={locations}
          onPick={(id) => place(sheetFor, id)}
          onClose={() => setSheetFor(null)}
        />
      ) : null}
    </div>
  );
}

function LocationSheet({
  title,
  current,
  locations,
  onPick,
  onClose,
}: {
  title: string;
  /** undefined = several soldiers (no current value) */
  current: string | null | undefined;
  locations: Loc[];
  onPick: (locationId: string | null) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <button type="button" className="tz-scrim" aria-label="סגירה" onClick={onClose} />
      <div className="tz-sheet" role="dialog" aria-modal="true" aria-label={`מיקום בשבצ״ק · ${title}`}>
        <div className="tz-grabber" />
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-2 pb-1">
          <button type="button" className="tz-btn tz-btn-plain justify-self-start" onClick={onClose}>
            ביטול
          </button>
          <span className="tz-headline">{title}</span>
          <span />
        </div>
        <p className="tz-footnote m-0 pb-3.5 text-center">מיקום בשבצ״ק</p>
        <div className="grid grid-cols-2 gap-2 px-4 sm:grid-cols-3">
          {locations.map((l, i) => (
            <button key={l.id} type="button" className="tz-option" aria-pressed={current === l.id} autoFocus={current === l.id || (!current && i === 0)} onClick={() => onPick(l.id)}>
              <Icon name="pin" size={16} />
              <span className="min-w-0 truncate">{l.name}</span>
            </button>
          ))}
        </div>
        {!locations.length ? <p className="tz-footnote m-0 px-8">עוד לא הוגדרו מיקומים. מנהל ראשי מגדיר אותם בהגדרות.</p> : null}
        {current !== null ? (
          <div className="px-4 pt-3">
            <button type="button" className="tz-btn tz-btn-plain" onClick={() => onPick(null)}>
              הוצאה מהשבצ״ק
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
