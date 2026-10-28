"use client";
/**
 * The edit sheet of a צ׳ (or of several, a group edit) — the same fields on צ׳ במערכת and on the
 * company page: מיקום, חותם על הפלוגה, חותם בפלוגה · תפקיד · מסגרת, האמר, הערה. Anyone covering
 * the company edits the holder inside it; a battalion admin (`isAdmin`) edits everything.
 */
import { useEffect, useId, useMemo, useState, useTransition } from "react";
import type { KesherLocation } from "@gdud/core";
import { Avatar, Button, Spinner } from "@gdud/ui";
import { PersonPicker, type PickPerson } from "@/components/person-picker";
import { saveSerials, type SerialPatch } from "../_actions/serials";

export interface SheetRow {
  serialId: string;
  serial: string;
  item: string;
  location: KesherLocation;
  unitId: string | null;
  vehicle: string | null;
  notes: string | null;
  holderPersonId: string | null;
  holderRole: string | null;
  frame: string | null;
  signerPersonId: string | null;
  signerRole: string | null;
}
export interface SheetPerson extends PickPerson {
  companyId: string | null;
  platoonName: string | null;
}
export interface SheetSuggestions {
  role: string[];
  frame: string[];
  signerRole: string[];
}

/** undefined = leave as is (a group edit starts that way); null = clear */
type Value<T> = T | null | undefined;
/** "warehouse" | "none" | a company id */
type Place = string;

const placeOf = (r: Pick<SheetRow, "location" | "unitId">): Place => (r.location === "company" ? r.unitId! : r.location);

export function SerialSheet({
  rows,
  people,
  companies,
  suggestions,
  isAdmin,
  onClose,
  onSaved,
}: {
  rows: SheetRow[];
  /** soldiers to pick from; filtered here by the צ׳'s company */
  people: SheetPerson[];
  /** the places a צ׳ can move to (admin) */
  companies: Array<{ id: string; name: string }>;
  suggestions: SheetSuggestions;
  isAdmin: boolean;
  onClose(): void;
  onSaved(changed: number): void;
}) {
  const one = rows.length === 1 ? rows[0]! : null;
  const samePlace = rows.every((r) => placeOf(r) === placeOf(rows[0]!)) ? placeOf(rows[0]!) : undefined;
  const [place, setPlace] = useState<Value<Place>>(one ? placeOf(one) : undefined);
  const [holder, setHolder] = useState<Value<string>>(one ? one.holderPersonId : undefined);
  const [role, setRole] = useState<Value<string>>(one ? one.holderRole : undefined);
  const [frame, setFrame] = useState<Value<string>>(one ? one.frame : undefined);
  const [signer, setSigner] = useState<Value<string>>(one ? one.signerPersonId : undefined);
  const [signerRole, setSignerRole] = useState<Value<string>>(one ? one.signerRole : undefined);
  const [vehicle, setVehicle] = useState<Value<string>>(one ? one.vehicle : undefined);
  const [notes, setNotes] = useState<Value<string>>(one ? one.notes : undefined);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // the company the צ׳ will be on; null = the warehouse / no place, undefined = several places
  const target = place ?? samePlace;
  const companyId = target === undefined ? undefined : target === "warehouse" || target === "none" ? null : target;
  const moved = place !== undefined && place !== samePlace;
  const companyPeople = useMemo(() => people.filter((p) => companyId && p.companyId === companyId), [people, companyId]);
  const person = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  function changePlace(next: Place) {
    setPlace(next);
    // another company: its soldiers only; the warehouse: nobody holds it
    const keep = next === samePlace;
    setHolder(keep && one ? one.holderPersonId : keep ? undefined : null);
    setSigner(keep && one ? one.signerPersonId : keep ? undefined : null);
    if (!keep) {
      setRole(null);
      setFrame(null);
      setSignerRole(null);
    }
  }

  // the chosen soldier's platoon is the first מסגרת suggestion
  const platoon = holder ? person.get(holder)?.platoonName : null;
  const frameSuggestions = platoon ? [platoon, ...suggestions.frame.filter((f) => f !== platoon)] : suggestions.frame;

  function save() {
    setError(undefined);
    // per row, only what was set and differs from the row
    const text = (v: Value<string>) => (v === undefined ? undefined : v?.trim() || null);
    const patches: SerialPatch[] = rows
      .map((r) => {
        const p: SerialPatch = { serialId: r.serialId, seenUnitId: r.unitId };
        const rowMoved = isAdmin && place !== undefined && place !== placeOf(r);
        if (rowMoved) {
          const company = place !== "warehouse" && place !== "none";
          p.place = { location: company ? "company" : (place as "warehouse" | "none"), unitId: company ? place : null };
        }
        const onCompany = rowMoved ? place !== "warehouse" && place !== "none" : r.location === "company";
        if (onCompany) {
          // after a move nothing is held yet: send every value set
          const holderWas = rowMoved ? null : r.holderPersonId;
          if (holder !== undefined && holder !== holderWas) p.holderPersonId = holder;
          if (text(role) !== undefined && text(role) !== (rowMoved ? null : r.holderRole)) p.holderRole = text(role);
          if (text(frame) !== undefined && text(frame) !== (rowMoved ? null : r.frame)) p.frame = text(frame);
          if (isAdmin && signer !== undefined && signer !== (rowMoved ? null : r.signerPersonId)) p.signerPersonId = signer;
          if (isAdmin && text(signerRole) !== undefined && text(signerRole) !== (rowMoved ? null : r.signerRole)) p.signerRole = text(signerRole);
        }
        if (isAdmin && text(vehicle) !== undefined && text(vehicle) !== r.vehicle) p.vehicle = text(vehicle);
        if (isAdmin && text(notes) !== undefined && text(notes) !== r.notes) p.notes = text(notes);
        return p;
      })
      .filter((p) => Object.keys(p).length > 2);
    if (!patches.length) return onSaved(0);
    start(async () => {
      const r = await saveSerials({ rows: patches });
      if (!r.ok) return setError(r.error);
      onSaved(r.data.changed);
    });
  }

  const title = one ? `${one.item} · צ׳ ${one.serial}` : `${rows.length} צ׳`;
  const onCompany = companyId !== null;
  return (
    <>
      <button type="button" className="tz-scrim" aria-label="סגירה" onClick={onClose} />
      <div className="tz-sheet" role="dialog" aria-modal="true" aria-label={`עריכה · ${title}`}>
        <div className="tz-grabber" />
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-2 pb-1">
          <button type="button" className="tz-btn tz-btn-plain justify-self-start" onClick={onClose}>
            ביטול
          </button>
          <span className="tz-headline">{title}</span>
          <button type="button" className="tz-btn tz-btn-plain justify-self-end font-semibold" onClick={save} disabled={pending}>
            {pending ? <Spinner size={14} /> : null}
            שמירה
          </button>
        </div>
        {one ? null : <p className="tz-footnote m-0 pb-2 text-center">שדה שלא משנים נשאר כמו שהוא בכל צ׳</p>}
        <div className="flex flex-col gap-4 px-4 pt-2">
          {error ? (
            <p role="alert" className="tz-alert tz-alert-error m-0 whitespace-pre-line">
              {error}
            </p>
          ) : null}
          {isAdmin ? (
            <section className="tz-card flex flex-col gap-3 p-4" aria-label="מיקום">
              <label className="tz-field">
                <span className="tz-label">מיקום</span>
                <select className="tz-input" value={place ?? ""} onChange={(e) => changePlace(e.target.value)}>
                  {place === undefined ? <option value="">ללא שינוי</option> : null}
                  <option value="warehouse">מחסן</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  <option value="none">ללא שיוך</option>
                </select>
              </label>
              {moved ? <p className="tz-footnote m-0">העברה מתקנת את המיקום בלבד ונרשמת ביומן כ״תיקון צ׳״.</p> : null}
            </section>
          ) : null}
          {onCompany && companyId !== undefined ? (
            <>
              {isAdmin ? (
                <section className="tz-card flex flex-col gap-3 p-4" aria-label="חותם על הפלוגה">
                  <h2 className="tz-panel-title p-0">חותם על הפלוגה</h2>
                  <SoldierField value={signer} onChange={setSigner} person={person} people={companyPeople} emptyLabel="ללא חותם על הפלוגה" />
                  <TextField label="תפקיד החותם" value={signerRole} onChange={setSignerRole} suggestions={suggestions.signerRole} keepable={!one && !moved} />
                </section>
              ) : null}
              <section className="tz-card flex flex-col gap-3 p-4" aria-label="חותם בפלוגה">
                <h2 className="tz-panel-title p-0">חותם בפלוגה</h2>
                <SoldierField value={holder} onChange={setHolder} person={person} people={companyPeople} />
                <div className="grid grid-cols-2 gap-3">
                  <TextField label="תפקיד" value={role} onChange={setRole} suggestions={suggestions.role} keepable={!one && !moved} />
                  <TextField label="מסגרת" value={frame} onChange={setFrame} suggestions={frameSuggestions} keepable={!one && !moved} />
                </div>
              </section>
            </>
          ) : null}
          {isAdmin ? (
            <section className="tz-card flex flex-col gap-3 p-4" aria-label="פרטי הצ׳">
              <TextField label="האמר (מספר רכב)" value={vehicle} onChange={setVehicle} suggestions={[]} keepable={!one} />
              <label className="tz-field">
                <span className="tz-label">הערה</span>
                <textarea
                  className="tz-input"
                  value={notes ?? ""}
                  placeholder={!one && notes === undefined ? "ללא שינוי" : undefined}
                  maxLength={500}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
            </section>
          ) : null}
          <p className="tz-footnote m-0">חיילים מרשימת דוח 1 של הפלוגה בלבד.</p>
        </div>
      </div>
    </>
  );
}

function SoldierField({
  value,
  onChange,
  person,
  people,
  emptyLabel = "ללא חותם",
}: {
  value: Value<string>;
  onChange(v: Value<string>): void;
  person: ReadonlyMap<string, SheetPerson>;
  people: SheetPerson[];
  emptyLabel?: string;
}) {
  const [picking, setPicking] = useState(false);
  const p = value ? person.get(value) : undefined;
  if (picking) {
    return (
      <div className="flex flex-col gap-2">
        <PersonPicker
          people={people}
          autoFocus
          onPick={(id) => {
            onChange(id);
            setPicking(false);
          }}
          empty="החייל לא ברשימת דוח 1 של הפלוגה — יש להוסיף אותו בדוח 1"
        />
        <div className="flex gap-2">
          <Button type="button" variant="plain" small onClick={() => setPicking(false)}>
            חזרה
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-control bg-ground p-3">
      {p ? <Avatar name={p.name} size={36} /> : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate text-[15px] ${p ? "font-semibold" : "text-ink-muted"}`}>
          {p ? p.name : value === undefined ? "ללא שינוי" : value ? "חייל שלא בפלוגה" : emptyLabel}
        </span>
        {p?.place ? <span className="tz-footnote truncate">{p.place}</span> : null}
      </span>
      {value ? (
        <Button type="button" variant="plain" small onClick={() => onChange(null)}>
          הסרה
        </Button>
      ) : null}
      <Button type="button" variant="plain" small onClick={() => setPicking(true)}>
        {value ? "שינוי" : "בחירה"}
      </Button>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  suggestions,
  keepable,
}: {
  label: string;
  value: Value<string>;
  onChange(v: string): void;
  suggestions: string[];
  keepable: boolean;
}) {
  const id = useId();
  return (
    <label className="tz-field">
      <span className="tz-label">{label}</span>
      <input
        className="tz-input"
        value={value ?? ""}
        placeholder={keepable && value === undefined ? "ללא שינוי" : undefined}
        maxLength={40}
        list={suggestions.length ? `${id}-list` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {suggestions.length ? (
        <datalist id={`${id}-list`}>
          {suggestions.slice(0, 30).map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
    </label>
  );
}
