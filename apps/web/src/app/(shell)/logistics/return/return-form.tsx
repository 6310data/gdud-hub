"use client";
/** זיכוי: pick a soldier, tick items, choose where they go (תקין / תקול / חטיבה). */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CONDITION_HINT, CONDITION_PLACE, LOGISTICS_CONDITIONS, matches, type Condition } from "@gdud/core";
import { Button, Chip, Serial } from "@gdud/ui";
import { returnItems } from "../_actions/signout";
import { PersonPicker, PickedPerson, type PickPerson } from "../_components/person-picker";
import { CONDITION_TILE, SmallTile } from "../_components/ui";

export interface ReturnData {
  people: PickPerson[];
  holdings: Record<string, Array<{ id: string; item: string; serial: string; sub: string; stored: boolean }>>;
}

export function ReturnForm({ data, initialPersonId, initialAssignmentId }: { data: ReturnData; initialPersonId?: string; initialAssignmentId?: string }) {
  const router = useRouter();
  const [personId, setPersonId] = useState(initialPersonId);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialAssignmentId ? [initialAssignmentId] : []));
  const [dest, setDest] = useState<Condition>("ok");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const [pending, start] = useTransition();

  const person = personId ? data.people.find((p) => p.id === personId) : undefined;
  const items = personId ? (data.holdings[personId] ?? []) : [];
  const chosen = items.filter((i) => selected.has(i.id));
  const allOn = items.length > 0 && chosen.length === items.length;

  function pick(id: string, query: string) {
    setPersonId(id);
    setDone(undefined);
    // typed a serial (3+ chars)? pre-select the matching items
    const q = query.trim();
    setSelected(new Set(q.length >= 3 ? (data.holdings[id] ?? []).filter((i) => matches(q, i.serial)).map((i) => i.id) : []));
  }
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function submit() {
    setError(undefined);
    start(async () => {
      const r = await returnItems({ assignmentIds: chosen.map((c) => c.id), destination: dest, notes: notes.trim() });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDone(`זוכו ${r.data.count} פריטים מ${person?.name ?? "החייל"} → ${CONDITION_PLACE[dest]}`);
      setSelected(new Set());
      setNotes("");
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="tz-title flex-1">זיכוי</h1>
        <Link href="/logistics" className="tz-btn tz-btn-plain tz-btn-sm">
          ביטול
        </Link>
      </div>
      {error ? (
        <p role="alert" className="tz-alert tz-alert-error m-0">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="tz-alert tz-alert-ok m-0">
          {done}
          {personId ? (
            <>
              {" · "}
              <Link href={`/logistics/people?person=${personId}`}>לכרטיס החייל</Link>
            </>
          ) : null}
        </p>
      ) : null}

      <div className="grid items-start gap-[22px] lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="בחירת פריטים לזיכוי" className="tz-card flex flex-col gap-3 p-4">
          {person ? (
            <PickedPerson
              person={person}
              onClear={() => {
                setPersonId(undefined);
                setSelected(new Set());
              }}
            />
          ) : (
            <PersonPicker people={data.people} onPick={pick} placeholder="חיפוש חייל לפי שם / מס׳ אישי / צ׳" autoFocus empty="לא נמצא חייל עם ציוד מוחתם" />
          )}
          {person ? (
            <>
              <div className="flex items-center justify-between">
                <h2 className="tz-panel-title">ציוד מוחתם · {items.length}</h2>
                {items.length ? (
                  <Button type="button" variant="plain" small onClick={() => setSelected(allOn ? new Set() : new Set(items.map((i) => i.id)))}>
                    {allOn ? "ניקוי" : "בחירת הכל"}
                  </Button>
                ) : null}
              </div>
              {items.length === 0 ? <div className="tz-footnote">אין ציוד מוחתם</div> : null}
              <div className="flex flex-col">
                {items.map((i) => (
                  <label key={i.id} className="flex cursor-pointer items-center gap-3 border-b border-separator py-2.5 last:border-0">
                    <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} aria-label={`${i.item} ${i.serial}`} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[15px]">{i.item}</span>
                      {i.sub ? <span className="truncate text-xs text-ink-muted">{i.sub}</span> : null}
                    </span>
                    <Serial>{i.serial}</Serial>
                    {i.stored ? <Chip tone="brigade">באפסון</Chip> : <Chip tone="signed">חתום</Chip>}
                  </label>
                ))}
              </div>
            </>
          ) : null}
        </section>

        <aside aria-label="יעד הציוד" className="flex flex-col gap-3 lg:sticky lg:top-6">
          <div className="tz-card flex flex-col gap-1 p-4">
            <h2 className="tz-headline">לאן הציוד חוזר?</h2>
            <span className="tz-footnote">
              {chosen.length ? (
                <>
                  {chosen.length} פריטים נבחרו:{" "}
                  {chosen.map((c, i) => (
                    <span key={c.id}>
                      {i ? " , " : ""}
                      <Serial>{c.serial}</Serial>
                    </span>
                  ))}
                </>
              ) : (
                "בחרו פריטים"
              )}
            </span>
          </div>
          <div role="radiogroup" aria-label="יעד הציוד" className="tz-group">
            {LOGISTICS_CONDITIONS.map((c) => (
              <label key={c} className="tz-row cursor-pointer">
                <SmallTile {...CONDITION_TILE[c]} />
                <span className="tz-row-body">
                  <span className="tz-row-title text-[15px]">
                    {CONDITION_PLACE[c]}
                    <span className="tz-row-sub text-xs">{CONDITION_HINT[c]}</span>
                  </span>
                  <input type="radio" name="dest" checked={dest === c} onChange={() => setDest(c)} aria-label={CONDITION_PLACE[c]} />
                </span>
              </label>
            ))}
          </div>
          <div className="tz-card flex flex-col gap-3 p-4">
            <label className="tz-field">
              <span className="tz-label">הערה</span>
              <textarea className="tz-input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="לדוגמה: שריטה בעדשה" />
            </label>
            <Button type="button" variant={dest === "ok" ? "filled" : "danger"} disabled={!chosen.length || pending} onClick={submit}>
              {pending ? "מזכה…" : `זיכוי ${chosen.length || ""} פריטים ל${CONDITION_PLACE[dest]}`}
            </Button>
            <span className="tz-footnote">
              ההחתמה תיסגר והצ׳ יסומן &quot;{CONDITION_PLACE[dest]}&quot;. פריטים באפסון ייצאו מהאפסון.
            </span>
          </div>
        </aside>
      </div>
    </>
  );
}
