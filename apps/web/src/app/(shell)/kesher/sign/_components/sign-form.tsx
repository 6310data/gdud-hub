"use client";
/**
 * החתמה לפלוגה: 1 company + signing soldier (+ תפקיד, date) · 2 warehouse צ׳ תקינים by device type
 * · 3 the cart: chosen צ׳ and ציוד משלים proposed from their תקן, each line a stepper capped at what
 * the warehouse can sign out. On a phone the submit lives in a sticky bar.
 */
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { expandKit, matches, normalizeSerial } from "@gdud/core";
import { Button, Chip, Icon, Serial, tintStyle } from "@gdud/ui";
import { PersonPicker, PickedPerson, type PickPerson } from "@/components/person-picker";
import { signToCompany } from "../../_actions/moves";
import { countByType, ErrorAlert, kitMap, QtyStepper, StepTitle, type CompanyOpt, type KitRecord } from "./parts";

export interface SignData {
  companies: CompanyOpt[];
  /** active soldiers, each with the company (subtree) they belong to */
  people: (PickPerson & { companyId: string })[];
  /** warehouse צ׳ that are תקין, sorted by device type then צ׳ */
  serials: { id: string; serial: string; item: string }[];
  brokenInWarehouse: number;
  /** ציוד משלים; available = warehouse תקין that can be signed out */
  items: { id: string; name: string; category: string | null; available: number }[];
  kits: KitRecord;
  /** the signed-in user (מחתים) */
  signer: string;
  /** yyyy-mm-dd, Israel */
  today: string;
  minDay: string;
}

const SHOWN = 60;

export function SignForm({ data, initialUnit }: { data: SignData; initialUnit?: string }) {
  const router = useRouter();
  const [unitId, setUnitId] = useState(initialUnit);
  const [personId, setPersonId] = useState<string>();
  const [role, setRole] = useState("");
  const [day, setDay] = useState(data.today);
  const [notes, setNotes] = useState("");
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [showAll, setShowAll] = useState<ReadonlySet<string>>(new Set());
  /** quantities the admin changed by hand (item id → qty) */
  const [edits, setEdits] = useState<Record<string, number>>({});
  /** items added by hand, in the order added */
  const [manual, setManual] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const company = data.companies.find((c) => c.id === unitId);
  const people = useMemo(() => data.people.filter((p) => p.companyId === unitId), [data.people, unitId]);
  const person = personId ? people.find((p) => p.id === personId) : undefined;

  const groups = useMemo(() => {
    const out = new Map<string, SignData["serials"]>();
    for (const x of data.serials) out.set(x.item, [...(out.get(x.item) ?? []), x]);
    return [...out];
  }, [data.serials]);
  const q = query.trim();
  const qSerial = normalizeSerial(q).toLowerCase();
  const shownGroups = q
    ? groups
        .map(([type, rows]) => [type, matches(q, type) ? rows : rows.filter((x) => x.serial.toLowerCase().includes(qSerial))] as const)
        .filter(([, rows]) => rows.length)
    : groups;

  /* the cart */
  const chosenRows = data.serials.filter((x) => chosen.has(x.id));
  const chosenGroups = [...countByType(chosenRows, (x) => x.item)];
  const proposedByName = expandKit(countByType(chosenRows, (x) => x.item), kitMap(data.kits));
  const proposed = new Map<string, number>();
  for (const i of data.items) {
    const n = proposedByName.get(i.name);
    if (n) proposed.set(i.id, n);
  }
  const qtyOf = (id: string) => edits[id] ?? proposed.get(id) ?? 0;
  const lines = data.items.filter((i) => proposed.has(i.id) || manual.includes(i.id) || (edits[i.id] ?? 0) > 0);
  const sendLines = lines.filter((i) => qtyOf(i.id) > 0);
  const over = lines.filter((i) => qtyOf(i.id) > i.available);
  const addable = data.items.filter((i) => !lines.some((l) => l.id === i.id));
  const units = sendLines.reduce((n, i) => n + qtyOf(i.id), 0);

  const missing = [!company && "פלוגה", !person && "חייל חותם", !chosen.size && !sendLines.length && "ציוד"].filter(Boolean).join(", ");
  const blocker = missing
    ? `חסר: ${missing}`
    : over.length
      ? `חורג מהמלאי: ${over.map((i) => i.name).join(", ")}`
      : day > data.today
        ? "תאריך עתידי"
        : day && day < data.minDay
          ? "התאריך רחוק מדי (עד שנה אחורה)"
          : null;
  const summary = `${chosen.size} צ׳ · ${units} פריטי ציוד משלים`;

  const toggle = (id: string) =>
    setChosen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const flip = (set: (f: (cur: ReadonlySet<string>) => ReadonlySet<string>) => void, key: string) =>
    set((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const setQty = (id: string, n: number) => setEdits((cur) => ({ ...cur, [id]: n }));
  const removeLine = (id: string) => {
    setManual((cur) => cur.filter((x) => x !== id));
    setEdits((cur) => ({ ...cur, [id]: 0 }));
  };
  const addLine = (id: string) => {
    const it = data.items.find((i) => i.id === id);
    if (!it) return;
    setManual((cur) => [...cur, id]);
    setEdits((cur) => ({ ...cur, [id]: it.available > 0 ? 1 : 0 }));
  };

  function pickCompany(id: string) {
    setUnitId(id);
    if (!data.people.some((p) => p.id === personId && p.companyId === id)) setPersonId(undefined);
    setError(undefined);
  }

  function submit() {
    if (blocker || !unitId || !personId) return;
    setError(undefined);
    start(async () => {
      const r = await signToCompany({
        unitId,
        signerPersonId: personId,
        signerRole: role,
        day: day === data.today ? null : day || null,
        notes,
        serialIds: [...chosen],
        lines: sendLines.map((i) => ({ itemId: i.id, qty: qtyOf(i.id) })),
      });
      if (!r.ok) return setError(r.error);
      router.push(`/kesher/companies/${unitId}`);
    });
  }

  const submitLabel = company ? `החתמה ל${company.name}` : "החתמה";

  return (
    <div className="flex flex-col gap-4 pb-28 lg:pb-0">
      <ErrorAlert error={error} />

      <div className="grid items-start gap-[22px] lg:grid-cols-3">
        {/* 1 · company and soldier */}
        <section aria-label="שלב 1 · פלוגה וחותם" className="tz-card flex flex-col gap-3 p-4">
          <StepTitle n={1} title="פלוגה וחותם" />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="פלוגה">
            {data.companies.map((c) => (
              <button key={c.id} type="button" className="tz-pill" aria-pressed={c.id === unitId} onClick={() => pickCompany(c.id)} disabled={pending}>
                <span aria-hidden="true" className="tz-dot" style={tintStyle(c.color)} />
                {c.name}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="tz-label">חייל חותם</span>
            {!company ? (
              <span className="tz-footnote">בחרו פלוגה קודם</span>
            ) : person ? (
              <PickedPerson person={person} onClear={() => setPersonId(undefined)} />
            ) : (
              <PersonPicker key={unitId} people={people} onPick={(id) => setPersonId(id)} empty={`לא נמצא ב${company.name} (חיילים פעילים ברשימת דוח 1)`} />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="tz-field">
              <span className="tz-label">תפקיד</span>
              <input className="tz-input" value={role} onChange={(e) => setRole(e.target.value)} maxLength={40} placeholder="למשל: קשר״פ" autoComplete="off" />
            </label>
            <label className="tz-field">
              <span className="tz-label">תאריך</span>
              <input className="tz-input" type="date" value={day} min={data.minDay} max={data.today} onChange={(e) => setDay(e.target.value)} />
            </label>
          </div>
          {day && day !== data.today ? <span className="tz-footnote">ההחתמה תירשם ביומן כרטרואקטיבית</span> : null}

          <div className="flex items-center gap-2 rounded-control bg-ground px-3 py-2.5 text-[14px]">
            <span className="text-ink-muted">מחתים</span>
            <span className="font-semibold">{data.signer}</span>
          </div>
        </section>

        {/* 2 · warehouse צ׳ */}
        <section aria-label="שלב 2 · צ׳ מהמחסן" className="tz-card flex flex-col gap-3 p-4">
          <StepTitle n={2} title="צ׳ מהמחסן" note={`${data.serials.length} תקינים`} />
          <label className="tz-search">
            <Icon name="search" size={15} />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש צ׳ (ספרות) או סוג מכשיר" aria-label="חיפוש צ׳" autoComplete="off" />
          </label>

          <div className="flex flex-col gap-2">
            {shownGroups.map(([type, rows]) => {
              const isOpen = Boolean(q) || open.has(type);
              const on = rows.filter((x) => chosen.has(x.id)).length;
              const all = showAll.has(type);
              return (
                <div key={type} className="rounded-control border border-separator">
                  <button type="button" aria-expanded={isOpen} onClick={() => flip(setOpen, type)} className="flex w-full items-center gap-2.5 bg-transparent px-3 py-2.5 text-start text-ink" disabled={Boolean(q)}>
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{type}</span>
                    <span className="tz-num text-xs text-ink-muted">{on ? `${on} נבחרו · ${rows.length}` : rows.length}</span>
                    <Icon name="chevron" size={15} className={`tz-chevron transition-transform ${isOpen ? "-rotate-90" : ""}`} />
                  </button>
                  {isOpen ? (
                    <div role="group" aria-label={`בחירת צ׳ ${type}`} className="flex flex-wrap gap-1.5 px-3 pb-3">
                      {(all ? rows : rows.slice(0, SHOWN)).map((x) => (
                        <button key={x.id} type="button" aria-pressed={chosen.has(x.id)} className="tz-pill bg-ground" onClick={() => toggle(x.id)} disabled={pending}>
                          {chosen.has(x.id) ? <Icon name="check" size={14} /> : null}
                          <Serial>{x.serial}</Serial>
                        </button>
                      ))}
                      {!all && rows.length > SHOWN ? (
                        <button type="button" className="tz-pill bg-ground text-primary" onClick={() => flip(setShowAll, type)}>
                          עוד {rows.length - SHOWN}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {!shownGroups.length ? <div className="tz-footnote px-1">{data.serials.length ? "אין צ׳ תקין במחסן שמתאים" : "אין צ׳ תקינים במחסן"}</div> : null}
          </div>
          {data.brokenInWarehouse ? <span className="tz-footnote">{data.brokenInWarehouse} תקולים במחסן — לא זמינים להחתמה</span> : null}
        </section>

        {/* 3 · the cart */}
        <section aria-label="שלב 3 · סיכום" className="tz-card flex flex-col gap-3 p-4 lg:sticky lg:top-6">
          <StepTitle n={3} title="סיכום" note={summary} />

          {chosenGroups.length ? (
            <div className="flex flex-col gap-2">
              {chosenGroups.map(([type, n]) => (
                <div key={type} className="flex flex-col gap-1.5 rounded-control bg-ground p-3">
                  <span className="text-[14px] font-semibold">
                    {type} <span className="tz-num font-normal text-ink-muted">· {n}</span>
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {chosenRows
                      .filter((x) => x.item === type)
                      .map((x) => (
                        <button key={x.id} type="button" className="tz-pill bg-surface" onClick={() => toggle(x.id)} aria-label={`הסרת ${type} ${x.serial}`} disabled={pending}>
                          <Serial>{x.serial}</Serial>
                          <Icon name="close" size={12} />
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <span className="tz-footnote">לא נבחרו צ׳ — אפשר להחתים גם ציוד משלים בלבד</span>
          )}

          <div className="flex items-center justify-between gap-2">
            <span className="tz-label">ציוד משלים</span>
            {Object.keys(edits).length ? (
              <button
                type="button"
                className="tz-btn tz-btn-plain tz-btn-sm min-h-0 px-0"
                onClick={() => {
                  setEdits({});
                  setManual([]);
                }}
              >
                איפוס לתקן
              </button>
            ) : null}
          </div>
          {lines.length ? (
            <div className="flex flex-col">
              {lines.map((i) => {
                const n = qtyOf(i.id);
                const kit = proposed.get(i.id);
                return (
                  <div key={i.id} className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-separator py-2 last:border-0 ${n ? "" : "opacity-60"}`}>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[14px]">{i.name}</span>
                      <span className="tz-num text-xs text-ink-muted">
                        במחסן {i.available}
                        {kit ? ` · תקן ${kit}` : ""}
                      </span>
                    </span>
                    {n > i.available ? <Chip tone="broken">חורג מהמלאי</Chip> : kit ? <Chip tone="signed">תקן</Chip> : <Chip tone="admin">ידני</Chip>}
                    <QtyStepper value={n} max={i.available} onChange={(v) => setQty(i.id, v)} label={`כמות ${i.name}`} />
                    {!kit ? (
                      <button type="button" className="tz-btn tz-btn-plain min-h-0 p-1 text-danger" aria-label={`הסרת ${i.name}`} onClick={() => removeLine(i.id)}>
                        <Icon name="close" size={15} />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <span className="tz-footnote">{chosen.size ? "אין תקן ציוד משלים לצ׳ שנבחרו" : "יוצע לפי תקן הצ׳ שנבחרו"}</span>
          )}
          {addable.length ? (
            <select className="tz-input" value="" onChange={(e) => addLine(e.target.value)} aria-label="הוספת פריט ציוד משלים" disabled={pending}>
              <option value="">+ הוספת פריט ידנית</option>
              {addable.map((i) => (
                <option key={i.id} value={i.id} disabled={i.available <= 0}>
                  {i.name} · במחסן {i.available}
                </option>
              ))}
            </select>
          ) : null}

          <label className="tz-field">
            <span className="tz-label">הערות</span>
            <textarea className="tz-input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder="לא חובה" />
          </label>

          <div className="flex flex-col gap-1.5 max-lg:hidden">
            <Button type="button" disabled={Boolean(blocker)} loading={pending} onClick={submit}>
              {pending ? null : <Icon name="pencil" size={18} />}
              {submitLabel}
            </Button>
            <span className={`tz-footnote ${blocker && !missing ? "text-danger" : ""}`}>{blocker ?? `${summary}${person ? ` · חותם: ${person.name}` : ""}`}</span>
          </div>
        </section>
      </div>

      {/* phone: the submit in a sticky bar */}
      <div className="tz-action-bar lg:hidden">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] font-semibold">{summary}</span>
          {blocker ? <span className={`truncate text-xs ${missing ? "text-ink-muted" : "text-danger"}`}>{blocker}</span> : null}
        </span>
        <Button type="button" small disabled={Boolean(blocker)} loading={pending} onClick={submit}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
