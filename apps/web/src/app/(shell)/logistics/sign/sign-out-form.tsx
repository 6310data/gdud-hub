"use client";
/** One-screen sign-out: 1 soldier · 2 equipment · 3 confirm (preview → issue form). */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { CONDITION_LABEL, matches, normalizeSerial, type Condition, type KitLine } from "@gdud/core";
import { Button, Chip, Icon, Serial } from "@gdud/ui";
import { signOutForm, type FormPerson } from "@/lib/logistics/forms";
import { signOut } from "../_actions/signout";
import { FormDocument } from "../_components/form-document";
import { KitEditor } from "../_components/kit-editor";
import { PersonPicker, PickedPerson, type PickPerson } from "@/components/person-picker";

export interface SignData {
  battalion: string;
  issuedBy: string;
  people: PickPerson[];
  /** only what the form preview prints */
  personCards: Record<string, FormPerson & { id: string }>;
  items: Array<{ id: string; name: string; category: string | null; kit: KitLine[] }>;
  serials: Array<{
    id: string;
    serial: string;
    itemId: string;
    condition: Condition;
    held: boolean;
    holderId: string | null;
    holderName: string | null;
    transferable: boolean;
  }>;
  holdings: Array<{ personId: string; item: string; serial: string }>;
}

interface CartLine {
  serialId: string;
  kit: KitLine[];
  /** name of the current holder when this is a transfer */
  from: string | null;
}

const SIGNER_KEY = "logistics.signer";

/** The last "מחתים" typed on this device (empty on the server and when storage is blocked). */
function readStoredSigner(): string {
  try {
    return localStorage.getItem(SIGNER_KEY) ?? "";
  } catch {
    return "";
  }
}
const noSubscribe = () => () => {};
const SERIALS_SHOWN = 30;

export function SignOutForm({ data, initialPersonId, initialSerialId }: { data: SignData; initialPersonId?: string; initialSerialId?: string }) {
  const router = useRouter();
  const itemById = useMemo(() => new Map(data.items.map((i) => [i.id, i])), [data.items]);
  const serialById = useMemo(() => new Map(data.serials.map((x) => [x.id, x])), [data.serials]);

  const [personId, setPersonId] = useState<string | undefined>(initialPersonId);
  const [cart, setCart] = useState<CartLine[]>(() => {
    const x = initialSerialId ? data.serials.find((s) => s.id === initialSerialId) : undefined;
    if (!x || (x.held && !x.transferable) || (!x.held && x.condition !== "ok")) return [];
    return [{ serialId: x.id, kit: itemById.get(x.itemId)?.kit ?? [], from: x.held ? x.holderName : null }];
  });
  const [query, setQuery] = useState("");
  const [openItem, setOpenItem] = useState<string>();
  const [showAll, setShowAll] = useState(false);
  const storedSigner = useSyncExternalStore(noSubscribe, readStoredSigner, () => "");
  const [typedSigner, setTypedSigner] = useState<string | null>(null);
  const signer = typedSigner ?? storedSigner;
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);

  const saveSigner = (v: string) => {
    setTypedSigner(v);
    try {
      localStorage.setItem(SIGNER_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const person = personId ? data.personCards[personId] : undefined;
  const picked = personId ? data.people.find((p) => p.id === personId) : undefined;
  const alreadyHeld = personId ? data.holdings.filter((h) => h.personId === personId) : [];
  const inCart = new Set(cart.map((c) => c.serialId));

  const available = useMemo(() => {
    const by = new Map<string, number>();
    for (const x of data.serials) if (!x.held && x.condition === "ok") by.set(x.itemId, (by.get(x.itemId) ?? 0) + 1);
    return by;
  }, [data.serials]);
  const totalAvailable = [...available.values()].reduce((a, b) => a + b, 0);

  const q = query.trim();
  const serialHits = q.length >= 2 ? data.serials.filter((x) => x.serial.toLowerCase().includes(normalizeSerial(q).toLowerCase())).slice(0, 8) : [];
  const itemHits = data.items.filter((i) => (available.get(i.id) ?? 0) > 0 && matches(q, i.name, i.category)).slice(0, q ? 20 : 10);

  function add(serialId: string) {
    const x = serialById.get(serialId);
    if (!x || inCart.has(serialId)) return;
    if (x.held && x.holderId === personId) {
      setError(`הצ׳ ${x.serial} כבר מוחתם על ${picked?.name ?? "החייל"}`);
      return;
    }
    setError(undefined);
    setCart((c) => [...c, { serialId, kit: itemById.get(x.itemId)?.kit ?? [], from: x.held ? x.holderName : null }]);
  }
  const remove = (serialId: string) => setCart((c) => c.filter((l) => l.serialId !== serialId));
  const toggle = (serialId: string) => (inCart.has(serialId) ? remove(serialId) : add(serialId));
  const setKit = (serialId: string, kit: KitLine[]) => setCart((c) => c.map((l) => (l.serialId === serialId ? { ...l, kit } : l)));

  const transfers = cart.filter((l) => l.from).length;
  const ready = Boolean(person && cart.length && signer.trim());
  const preview =
    person && cart.length
      ? signOutForm({
          battalion: data.battalion,
          person,
          issuedBy: data.issuedBy,
          signer: signer.trim(),
          notes: notes.trim(),
          lines: cart.map((l) => {
            const x = serialById.get(l.serialId)!;
            return { item: itemById.get(x.itemId)?.name ?? "", serial: x.serial, kit: l.kit };
          }),
        })
      : null;

  function issue() {
    if (!person) return;
    start(async () => {
      const r = await signOut({
        personId: person.id,
        signer: signer.trim(),
        notes: notes.trim(),
        transfer: transfers > 0,
        lines: cart.map((l) => ({ serialId: l.serialId, kit: l.kit })),
      });
      if (r.ok) {
        dialog.current?.close();
        router.push(`/logistics/forms/${r.data.formId}?done=1`);
      } else {
        dialog.current?.close();
        setError(r.error);
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex flex-1 flex-col">
          <h1 className="tz-title">החתמה חדשה</h1>
          <span className="tz-footnote">חייל, ציוד ואישור במסך אחד</span>
        </span>
        <Link href="/logistics" className="tz-btn tz-btn-plain tz-btn-sm">
          ביטול
        </Link>
      </div>

      {error ? (
        <p role="alert" className="tz-alert tz-alert-error m-0">
          {error}
        </p>
      ) : null}

      <div className="grid items-start gap-[22px] lg:grid-cols-3">
        {/* 1 · soldier */}
        <section aria-label="שלב 1 · חייל" className="tz-card flex flex-col gap-3 p-4">
          <StepTitle n={1} title="חייל" />
          {picked ? (
            <>
              <PickedPerson person={picked} onClear={() => setPersonId(undefined)} />
              {alreadyHeld.length ? (
                <div className="flex flex-col gap-1">
                  <div className="text-xs font-semibold text-ink-muted">כבר חתום · {alreadyHeld.length} פריטים</div>
                  {alreadyHeld.map((h) => (
                    <span key={h.serial} className="flex items-center justify-between gap-2 text-[13px]">
                      <span className="truncate">{h.item}</span>
                      <Serial>{h.serial}</Serial>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="tz-footnote">אין עדיין ציוד מוחתם</div>
              )}
            </>
          ) : (
            <PersonPicker
              people={data.people}
              onPick={(id) => setPersonId(id)}
              autoFocus
              empty="לא נמצא באלפון"
            />
          )}
        </section>

        {/* 2 · equipment */}
        <section aria-label="שלב 2 · ציוד" className="tz-card flex flex-col gap-3 p-4">
          <StepTitle n={2} title="ציוד" note={`${totalAvailable.toLocaleString("he-IL")} פנויים במחסן`} />
          <label className="tz-search">
            <Icon name="search" size={15} />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש פריט או צ׳" aria-label="חיפוש פריט או צ׳" autoComplete="off" />
          </label>

          {serialHits.length ? (
            <div className="flex flex-col">
              <div className="text-xs font-semibold text-ink-muted">צ׳ים</div>
              {serialHits.map((x) => {
                const blocked = (x.held && !x.transferable) || (!x.held && x.condition !== "ok") || x.holderId === personId;
                return (
                  <button
                    key={x.id}
                    type="button"
                    disabled={blocked}
                    onClick={() => toggle(x.id)}
                    className="flex items-center gap-2 border-b border-separator bg-transparent py-2 text-start text-ink last:border-0 disabled:opacity-50"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[14px]">{itemById.get(x.itemId)?.name}</span>
                      <Serial>{x.serial}</Serial>
                    </span>
                    {x.held ? (
                      <Chip tone="signed">{x.holderName ? `אצל ${x.holderName}` : "חתום"}</Chip>
                    ) : x.condition !== "ok" ? (
                      <Chip tone={x.condition}>{CONDITION_LABEL[x.condition]}</Chip>
                    ) : (
                      <Chip tone="ok">פנוי</Chip>
                    )}
                    <Icon name={inCart.has(x.id) ? "check" : "plus"} size={18} className="text-primary" />
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            {itemHits.map((it) => {
              const open = openItem === it.id;
              const free = data.serials.filter((x) => x.itemId === it.id && !x.held && x.condition === "ok");
              return (
                <div key={it.id} className="rounded-control border border-separator">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => {
                      setOpenItem(open ? undefined : it.id);
                      setShowAll(false);
                    }}
                    className="flex w-full items-center gap-2.5 bg-transparent px-3 py-2.5 text-start text-ink"
                  >
                    <span className="tz-tile size-7" style={{ background: "var(--tile-ok)" }}>
                      <Icon name="box" size={15} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[14px] font-medium">{it.name}</span>
                      <span className="text-xs text-ink-muted">{[it.category, `${free.length} פנויים`].filter(Boolean).join(" · ")}</span>
                    </span>
                    <Icon name="chevron" size={15} className={`tz-chevron transition-transform ${open ? "-rotate-90" : ""}`} />
                  </button>
                  {open ? (
                    <div role="group" aria-label={`בחירת צ׳ ל${it.name}`} className="flex flex-wrap gap-1.5 px-3 pb-3">
                      {(showAll ? free : free.slice(0, SERIALS_SHOWN)).map((x) => (
                        <button key={x.id} type="button" aria-pressed={inCart.has(x.id)} className="tz-pill bg-ground" onClick={() => toggle(x.id)}>
                          {inCart.has(x.id) ? <Icon name="check" size={14} /> : null}
                          <Serial>{x.serial}</Serial>
                        </button>
                      ))}
                      {!showAll && free.length > SERIALS_SHOWN ? (
                        <button type="button" className="tz-pill bg-ground text-primary" onClick={() => setShowAll(true)}>
                          עוד {free.length - SERIALS_SHOWN}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {!itemHits.length && !serialHits.length ? <div className="tz-footnote px-1">אין פריט פנוי שמתאים</div> : null}
          </div>
        </section>

        {/* 3 · confirm */}
        <section aria-label="שלב 3 · אישור" className="tz-card flex flex-col gap-3 p-4 lg:sticky lg:top-6">
          <StepTitle n={3} title="אישור" note={`${cart.length} פריטים`} />
          {cart.length === 0 ? <div className="tz-footnote">בחרו ציוד מהעמודה האמצעית</div> : null}
          {cart.map((l) => {
            const x = serialById.get(l.serialId)!;
            return (
              <div key={l.serialId} className="flex flex-col gap-2 rounded-control bg-ground p-3">
                <div className="flex items-center gap-2">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[14px] font-semibold">{itemById.get(x.itemId)?.name}</span>
                    <Serial>{x.serial}</Serial>
                  </span>
                  <button type="button" className="tz-btn tz-btn-plain min-h-0 p-1 text-danger" aria-label={`הסרת ${x.serial}`} onClick={() => remove(l.serialId)}>
                    <Icon name="close" size={16} />
                  </button>
                </div>
                {l.from ? (
                  <span className="tz-chip tz-chip-admin self-start">
                    <Icon name="swap" size={12} />
                    העברה מ{l.from}
                  </span>
                ) : null}
                <div className="text-xs font-semibold text-ink-muted">ציוד משלים</div>
                <KitEditor value={l.kit} onChange={(k) => setKit(l.serialId, k)} compact />
              </div>
            );
          })}
          <label className="tz-field">
            <span className="tz-label">מחתים</span>
            <input className="tz-input" value={signer} onChange={(e) => saveSigner(e.target.value)} maxLength={80} placeholder="מי מבצע את ההחתמה" autoComplete="off" />
          </label>
          <label className="tz-field">
            <span className="tz-label">הערות לטופס</span>
            <textarea className="tz-input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="לא חובה" />
          </label>
          <Button type="button" disabled={!ready || pending} onClick={() => dialog.current?.showModal()}>
            <Icon name="doc" size={18} />
            תצוגה מקדימה והחתמה
          </Button>
          <span className="tz-footnote">
            {!person ? "בחרו חייל" : !cart.length ? "בחרו ציוד" : !signer.trim() ? "הזינו את שם המחתים" : "ייווצר טופס החתמה, והצ׳ים יסומנו כחתומים"}
            {transfers ? ` · ${transfers} מהפריטים יועברו מחייל אחר` : ""}
          </span>
        </section>
      </div>

      <dialog ref={dialog} className="tz-dialog" aria-label="תצוגה מקדימה – טופס החתמה">
        <div className="flex max-h-[calc(100dvh-48px)] flex-col">
          <div className="flex items-center gap-2 border-b border-separator px-4 py-3">
            <h2 className="tz-headline flex-1">תצוגה מקדימה – טופס החתמה</h2>
            <button type="button" className="tz-btn tz-btn-plain min-h-0 p-1" aria-label="סגירה" onClick={() => dialog.current?.close()}>
              <Icon name="close" size={18} />
            </button>
          </div>
          <div className="overflow-y-auto bg-ground p-3">{preview ? <FormDocument data={preview} kind="signout" /> : null}</div>
          <div className="flex gap-2 border-t border-separator px-4 py-3">
            <Button type="button" variant="tinted" className="flex-1" onClick={() => dialog.current?.close()}>
              חזרה לעריכה
            </Button>
            <Button type="button" className="flex-1" disabled={!ready} loading={pending} onClick={issue}>
              {pending ? null : <Icon name="pencil" size={18} />}
              {pending ? "מחתים…" : "הנפקת טופס והחתמה"}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}

function StepTitle({ n, title, note }: { n: number; title: string; note?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="tz-step">{n}</span>
      <h2 className="tz-headline flex-1">{title}</h2>
      {note ? <span className="text-xs text-ink-muted">{note}</span> : null}
    </div>
  );
}
