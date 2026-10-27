"use client";
/** אפסון / הוצאה מאפסון: pick a soldier, tick items, confirm. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { matches } from "@gdud/core";
import { Button, Chip, Icon, Serial } from "@gdud/ui";
import { releaseItems, storeItems } from "../_actions/storage";
import { PersonPicker, PickedPerson, type PickPerson } from "@/components/person-picker";

export interface StorageLine {
  /** serial id (store) or storage row id (release) */
  id: string;
  item: string;
  serial: string | null;
  sub?: string;
  disabledReason?: string;
}

export interface StorageData {
  mode: "in" | "out";
  people: PickPerson[];
  lines: Record<string, StorageLine[]>;
  /** item names for "item without serial" (store only) */
  itemNames: string[];
}

const TEXT = {
  in: { title: "אפסון ציוד", who: "של מי הציוד?", what: "מה נכנס לאפסון?", button: "אפסון", done: "נכנסו לאפסון", note: "הציוד נשאר מוחתם על החייל." },
  out: { title: "הוצאה מאפסון", who: "למי מוציאים?", what: "מה יוצא מהאפסון?", button: "הוצאה", done: "יצאו מהאפסון", note: "שורת האפסון נסגרת (ההיסטוריה נשמרת)." },
};

export function StorageForm({ data, initialPersonId }: { data: StorageData; initialPersonId?: string }) {
  const t = TEXT[data.mode];
  const router = useRouter();
  const [personId, setPersonId] = useState(initialPersonId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [extras, setExtras] = useState<string[]>([]);
  const [extra, setExtra] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const [pending, start] = useTransition();

  const person = personId ? data.people.find((p) => p.id === personId) : undefined;
  const lines = personId ? (data.lines[personId] ?? []) : [];
  const free = lines.filter((l) => !l.disabledReason);
  const allOn = free.length > 0 && free.every((l) => selected.has(l.id));
  const count = selected.size + extras.length;

  const pick = (id: string, query: string) => {
    setPersonId(id);
    setDone(undefined);
    setExtras([]);
    const q = query.trim();
    setSelected(new Set(q.length >= 3 ? (data.lines[id] ?? []).filter((l) => !l.disabledReason && matches(q, l.serial)).map((l) => l.id) : []));
  };
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function submit() {
    if (!personId) return;
    setError(undefined);
    start(async () => {
      const r =
        data.mode === "in"
          ? await storeItems({ personId, notes: notes.trim(), serialIds: [...selected], extras })
          : await releaseItems({ storageIds: [...selected], notes: notes.trim() });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDone(`${r.data.count} פריטים ${t.done}`);
      setSelected(new Set());
      setExtras([]);
      setNotes("");
      router.refresh();
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="tz-title flex-1">{t.title}</h1>
        <Link href="/logistics/storage" className="tz-btn tz-btn-plain tz-btn-sm">
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

      <section className="tz-card flex flex-col gap-3 p-4">
        <h2 className="tz-headline">{t.who}</h2>
        {person ? (
          <PickedPerson
            person={person}
            onClear={() => {
              setPersonId(undefined);
              setSelected(new Set());
            }}
          />
        ) : (
          <PersonPicker people={data.people} onPick={pick} placeholder="חיפוש חייל / מס׳ אישי / צ׳" autoFocus />
        )}
      </section>

      {person ? (
        <section className="tz-card flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="tz-headline">{t.what}</h2>
            {free.length ? (
              <Button type="button" variant="plain" small onClick={() => setSelected(allOn ? new Set() : new Set(free.map((l) => l.id)))}>
                {allOn ? "ניקוי" : "בחירת הכל"}
              </Button>
            ) : null}
          </div>
          {lines.length === 0 ? <div className="tz-footnote">{data.mode === "in" ? "אין ציוד מוחתם" : "אין פריטים באפסון"}</div> : null}
          <div className="flex flex-col">
            {lines.map((l) => (
              <label key={l.id} className={`flex items-center gap-3 border-b border-separator py-2.5 last:border-0 ${l.disabledReason ? "opacity-55" : "cursor-pointer"}`}>
                <input type="checkbox" disabled={Boolean(l.disabledReason)} checked={selected.has(l.id)} onChange={() => toggle(l.id)} aria-label={`${l.item} ${l.serial ?? ""}`} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px]">{l.item}</span>
                  {l.sub ? <span className="text-xs text-ink-muted">{l.sub}</span> : null}
                </span>
                {l.serial ? <Serial>{l.serial}</Serial> : <span className="text-xs text-ink-muted">ללא צ׳</span>}
                {l.disabledReason ? <Chip tone="brigade">{l.disabledReason}</Chip> : null}
              </label>
            ))}
          </div>

          {data.mode === "in" ? (
            <div className="flex flex-col gap-2">
              <div className="text-xs font-semibold text-ink-muted">פריט ללא צ׳ (לא חובה)</div>
              {extras.map((x, i) => (
                <div key={`${x}-${i}`} className="flex items-center gap-2 text-[14px]">
                  <span className="flex-1">{x}</span>
                  <button type="button" className="tz-btn tz-btn-plain min-h-0 p-1 text-danger" aria-label={`הסרת ${x}`} onClick={() => setExtras((e) => e.filter((_, j) => j !== i))}>
                    <Icon name="close" size={15} />
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <input className="tz-input" list="storage-items" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="שם פריט" maxLength={80} />
                <Button
                  type="button"
                  variant="tinted"
                  small
                  onClick={() => {
                    if (extra.trim()) setExtras((e) => [...e, extra.trim()]);
                    setExtra("");
                  }}
                >
                  הוספה
                </Button>
              </div>
              <datalist id="storage-items">
                {data.itemNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </div>
          ) : null}

          <label className="tz-field">
            <span className="tz-label">הערה ללוג</span>
            <input className="tz-input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder="לא חובה" />
          </label>
          <Button type="button" disabled={!count} loading={pending} onClick={submit}>
            {pending ? null : <Icon name="archive" size={18} />}
            {pending ? "שומר…" : `${t.button}${count ? ` · ${count} פריטים` : ""}`}
          </Button>
          <span className="tz-footnote">{t.note}</span>
        </section>
      ) : null}
    </div>
  );
}
