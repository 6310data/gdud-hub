"use client";
/**
 * שיוך בתוך הפלוגה on the company page: a pencil per row, checkboxes for a group edit, and one
 * sheet for both. The table itself stays a server component; these islands share the selection
 * through context. Signer fields (חותם על הפלוגה) only for a battalion admin (`canSign`).
 */
import { createContext, useContext, useEffect, useId, useMemo, useState, useTransition, type ReactNode } from "react";
import { Avatar, Button, Icon, Spinner } from "@gdud/ui";
import { PersonPicker, type PickPerson } from "@/components/person-picker";
import { saveHolders, type HolderPatch } from "../../../_actions/holders";

export interface AssignRow {
  serialId: string;
  serial: string;
  item: string;
  holderPersonId: string | null;
  holderRole: string | null;
  frame: string | null;
  signerPersonId: string | null;
  signerRole: string | null;
}
export interface AssignPerson extends PickPerson {
  platoonName: string | null;
}

interface Ctx {
  selected: ReadonlySet<string>;
  toggle(ids: readonly string[], on: boolean): void;
  open(ids: readonly string[]): void;
}
const AssignCtx = createContext<Ctx | null>(null);
const useAssign = () => useContext(AssignCtx);

const TOAST_MS = 4000;

export function AssignProvider({
  unitId,
  rows,
  people,
  canSign,
  children,
}: {
  unitId: string;
  rows: AssignRow[];
  people: AssignPerson[];
  canSign: boolean;
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [sheetFor, setSheetFor] = useState<readonly string[] | null>(null);
  const [toast, setToast] = useState<string>();
  const byId = useMemo(() => new Map(rows.map((r) => [r.serialId, r])), [rows]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const ctx: Ctx = {
    selected,
    toggle: (ids, on) =>
      setSelected((cur) => {
        const next = new Set(cur);
        for (const id of ids) {
          if (on) next.add(id);
          else next.delete(id);
        }
        return next;
      }),
    open: (ids) => setSheetFor(ids),
  };
  const editing = sheetFor?.map((id) => byId.get(id)).filter((r): r is AssignRow => Boolean(r)) ?? [];

  return (
    <AssignCtx.Provider value={ctx}>
      {children}
      {selected.size ? (
        <div className="tz-action-bar lg:sticky lg:bottom-4 lg:rounded-group">
          <span className="text-[15px] font-semibold">{selected.size} נבחרו</span>
          <button type="button" className="tz-btn tz-btn-plain tz-btn-sm" onClick={() => setSelected(new Set())}>
            ניקוי
          </button>
          <button type="button" className="tz-btn tz-btn-filled tz-btn-sm ms-auto" onClick={() => setSheetFor([...selected])}>
            <Icon name="pencil" size={15} />
            שיוך לנבחרים
          </button>
        </div>
      ) : null}
      {editing.length ? (
        <AssignSheet
          key={editing.map((r) => r.serialId).join(",")}
          unitId={unitId}
          rows={editing}
          people={people}
          suggestions={{ role: distinct(rows.map((r) => r.holderRole)), frame: distinct(rows.map((r) => r.frame)), signerRole: distinct(rows.map((r) => r.signerRole)) }}
          canSign={canSign}
          onClose={() => setSheetFor(null)}
          onSaved={(n) => {
            setSheetFor(null);
            setSelected(new Set());
            setToast(n ? `השיוך עודכן ב־${n} צ׳` : "לא היה מה לשנות");
          }}
        />
      ) : null}
      {toast ? (
        <div className="tz-toast lg:bottom-6" role="status">
          <span>{toast}</span>
        </div>
      ) : null}
    </AssignCtx.Provider>
  );
}

const distinct = (list: (string | null)[]) => [...new Set(list.filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b, "he"));

/** A row's checkbox (part of a group edit). */
export function RowCheck({ id, label }: { id: string; label: string }) {
  const ctx = useAssign();
  if (!ctx) return null;
  return <input type="checkbox" checked={ctx.selected.has(id)} onChange={(e) => ctx.toggle([id], e.target.checked)} aria-label={`בחירת ${label}`} />;
}

/** "סימון הקבוצה": selects every row of a device type. */
export function GroupCheck({ ids, label }: { ids: readonly string[]; label: string }) {
  const ctx = useAssign();
  if (!ctx) return null;
  const all = ids.length > 0 && ids.every((id) => ctx.selected.has(id));
  return <input type="checkbox" checked={all} onChange={() => ctx.toggle(ids, !all)} aria-label={`בחירת כל ${label}`} />;
}

/** The pencil: edit one row. */
export function RowEdit({ id, label }: { id: string; label: string }) {
  const ctx = useAssign();
  if (!ctx) return null;
  return (
    <button type="button" className="tz-icon-btn" onClick={() => ctx.open([id])} aria-label={`עריכת שיוך ${label}`}>
      <Icon name="pencil" size={16} />
    </button>
  );
}

/* ── the sheet ── */

/** undefined = leave as is (a group edit starts that way); null = clear */
type Value<T> = T | null | undefined;

function AssignSheet({
  unitId,
  rows,
  people,
  suggestions,
  canSign,
  onClose,
  onSaved,
}: {
  unitId: string;
  rows: AssignRow[];
  people: AssignPerson[];
  suggestions: { role: string[]; frame: string[]; signerRole: string[] };
  canSign: boolean;
  onClose(): void;
  onSaved(changed: number): void;
}) {
  const one = rows.length === 1 ? rows[0]! : null;
  const [holder, setHolder] = useState<Value<string>>(one ? one.holderPersonId : undefined);
  const [role, setRole] = useState<Value<string>>(one ? one.holderRole : undefined);
  const [frame, setFrame] = useState<Value<string>>(one ? one.frame : undefined);
  const [signer, setSigner] = useState<Value<string>>(one ? one.signerPersonId : undefined);
  const [signerRole, setSignerRole] = useState<Value<string>>(one ? one.signerRole : undefined);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const person = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // the chosen soldier's platoon is the first מסגרת suggestion
  const platoon = holder ? person.get(holder)?.platoonName : null;
  const frameSuggestions = platoon ? [platoon, ...suggestions.frame.filter((f) => f !== platoon)] : suggestions.frame;

  function save() {
    setError(undefined);
    // per row, only what was set and differs from the row
    const text = (v: Value<string>) => (v === undefined ? undefined : v?.trim() || null);
    const patches: HolderPatch[] = rows
      .map((r) => {
        const p: HolderPatch = { serialId: r.serialId };
        if (holder !== undefined && holder !== r.holderPersonId) p.holderPersonId = holder;
        if (text(role) !== undefined && text(role) !== r.holderRole) p.holderRole = text(role);
        if (text(frame) !== undefined && text(frame) !== r.frame) p.frame = text(frame);
        if (canSign && signer !== undefined && signer !== r.signerPersonId) p.signerPersonId = signer;
        if (canSign && text(signerRole) !== undefined && text(signerRole) !== r.signerRole) p.signerRole = text(signerRole);
        return p;
      })
      .filter((p) => Object.keys(p).length > 1);
    if (!patches.length) return onSaved(0);
    start(async () => {
      const r = await saveHolders({ unitId, rows: patches });
      if (!r.ok) return setError(r.error);
      onSaved(r.data.changed);
    });
  }

  const title = one ? `${one.item} · צ׳ ${one.serial}` : `${rows.length} צ׳`;
  return (
    <>
      <button type="button" className="tz-scrim" aria-label="סגירה" onClick={onClose} />
      <div className="tz-sheet" role="dialog" aria-modal="true" aria-label={`שיוך · ${title}`}>
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
            <p role="alert" className="tz-alert tz-alert-error m-0">
              {error}
            </p>
          ) : null}
          <section className="tz-card flex flex-col gap-3 p-4" aria-label="שיוך בתוך הפלוגה">
            <h2 className="tz-panel-title p-0">חתום בתוך הפלוגה</h2>
            <SoldierField value={holder} onChange={setHolder} person={person} people={people} />
            <div className="grid grid-cols-2 gap-3">
              <TextField label="תפקיד" value={role} onChange={setRole} suggestions={suggestions.role} keepable={!one} />
              <TextField label="מסגרת" value={frame} onChange={setFrame} suggestions={frameSuggestions} keepable={!one} />
            </div>
          </section>
          {canSign ? (
            <section className="tz-card flex flex-col gap-3 p-4" aria-label="חותם על הפלוגה">
              <h2 className="tz-panel-title p-0">חותם על הפלוגה (מי חתום)</h2>
              <SoldierField value={signer} onChange={setSigner} person={person} people={people} emptyLabel="ללא חותם על הפלוגה" />
              <TextField label="תפקיד החותם" value={signerRole} onChange={setSignerRole} suggestions={suggestions.signerRole} keepable={!one} />
            </section>
          ) : null}
          <p className="tz-footnote m-0">השיוך לא מעביר את הצ׳ מהפלוגה. חיילים מרשימת דוח 1 של הפלוגה בלבד.</p>
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
  person: ReadonlyMap<string, AssignPerson>;
  people: AssignPerson[];
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
        list={`${id}-list`}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={`${id}-list`}>
        {suggestions.slice(0, 30).map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </label>
  );
}
