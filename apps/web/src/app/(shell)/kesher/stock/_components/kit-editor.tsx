"use client";
/**
 * תקן ציוד משלים: a panel per parent item. A battalion admin adds a line (parent → ציוד משלים × qty),
 * changes a quantity with the stepper, or removes a line; each change saves at once.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Chip, Icon, Spinner } from "@gdud/ui";
import { Empty, Panel } from "@/components/page-parts";
import { saveKit, type KitChange } from "../../_actions/stock";

export interface KitItem {
  id: string;
  name: string;
  bulk: boolean;
}
export interface KitLineVM {
  id: string;
  parentItemId: string;
  itemId: string;
  qty: number;
}

export function KitEditor({ items, lines, canEdit }: { items: KitItem[]; lines: KitLineVM[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string | null>(null);
  const [parent, setParent] = useState("");
  const [child, setChild] = useState("");
  const [qty, setQty] = useState(1);

  const byId = new Map(items.map((i) => [i.id, i]));
  const parents = [...new Set(lines.map((l) => l.parentItemId))]
    .map((id) => byId.get(id))
    .filter((i): i is KitItem => Boolean(i))
    .sort((a, b) => a.name.localeCompare(b.name, "he"));
  const hasKit = new Set(lines.map((l) => l.parentItemId));
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name, "he"));

  function run(change: KitChange, tag: string, after?: () => void) {
    setError(undefined);
    setBusy(tag);
    start(async () => {
      const r = await saveKit(change);
      setBusy(null);
      if (r.error) return setError(r.error);
      after?.();
      router.refresh();
    });
  }

  return (
    <>
      {canEdit ? (
        <form
          className="tz-card flex flex-wrap items-end gap-3 px-4 py-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (parent && child) run({ op: "add", parentItemId: parent, itemId: child, qty }, "add", () => setChild(""));
          }}
        >
          <label className="tz-field min-w-[160px] flex-1">
            <span className="tz-label">פריט אב</span>
            <select className="tz-input" value={parent} onChange={(e) => setParent(e.target.value)} required>
              <option value="">בחירה…</option>
              {sorted.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                  {i.bulk ? " (ציוד משלים)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="tz-field min-w-[160px] flex-1">
            <span className="tz-label">ציוד משלים</span>
            <select className="tz-input" value={child} onChange={(e) => setChild(e.target.value)} required>
              <option value="">בחירה…</option>
              {sorted
                .filter((i) => i.bulk && i.id !== parent && !lines.some((l) => l.parentItemId === parent && l.itemId === i.id))
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="tz-field w-[96px]">
            <span className="tz-label">כמות ליחידה</span>
            <input
              className="tz-input tz-num text-center"
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(Math.max(1, Math.min(99, Number(e.target.value.replace(/\D/g, "")) || 1)))}
            />
          </label>
          <button type="submit" className="tz-btn tz-btn-filled" disabled={pending || !parent || !child} aria-busy={busy === "add" || undefined}>
            {busy === "add" ? <Spinner size={14} /> : <Icon name="plus" size={16} />}
            הוספה לתקן
          </button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="tz-alert tz-alert-error m-0">
          {error}
        </p>
      ) : null}
      {!parents.length ? (
        <div className="tz-card">
          <Empty>עדיין אין תקן. מייבאים אותו מלשונית &quot;תקן ציוד משלים&quot; של הגיליון{canEdit ? " או מוסיפים כאן" : ""}.</Empty>
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-[22px]">
          {parents.map((p) => (
            <div key={p.id} className="min-w-0 flex-[1_1_300px]">
              <Panel
                title={
                  <span className="inline-flex items-center gap-2">
                    {p.name}
                    {p.bulk ? <Chip tone="brigade">ציוד משלים</Chip> : null}
                  </span>
                }
              >
                {lines
                  .filter((l) => l.parentItemId === p.id)
                  .map((l) => {
                    const name = byId.get(l.itemId)?.name ?? "—";
                    const mine = busy === l.id;
                    return (
                      <div key={l.id} className="tz-row">
                        <span className="tz-row-body min-h-[42px] py-0">
                          <span className="tz-row-title text-[14px]">
                            {name}
                            {hasKit.has(l.itemId) ? <span className="tz-row-sub text-xs">כולל את התקן שלו</span> : null}
                          </span>
                          {canEdit ? (
                            <span className="flex items-center gap-2">
                              {mine ? <Spinner size={14} /> : null}
                              <span className="tz-stepper">
                                <button type="button" aria-label={`פחות ${name}`} disabled={pending || l.qty <= 1} onClick={() => run({ op: "qty", kitId: l.id, qty: l.qty - 1 }, l.id)}>
                                  <Icon name="minus" size={14} />
                                </button>
                                <output className="tz-num" aria-label={`כמות ${name}`}>
                                  {l.qty}
                                </output>
                                <button type="button" aria-label={`עוד ${name}`} disabled={pending || l.qty >= 99} onClick={() => run({ op: "qty", kitId: l.id, qty: l.qty + 1 }, l.id)}>
                                  <Icon name="plus" size={14} />
                                </button>
                              </span>
                              <button type="button" className="tz-icon-btn" aria-label={`הסרת ${name} מהתקן של ${p.name}`} disabled={pending} onClick={() => run({ op: "remove", kitId: l.id }, l.id)}>
                                <Icon name="trash" size={16} />
                              </button>
                            </span>
                          ) : (
                            <span className="tz-num">×{l.qty}</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
              </Panel>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
