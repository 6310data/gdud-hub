"use client";
/**
 * Settings → קטגוריות: the category of each device type (orders the דוח לחטיבה) and of each ציוד
 * משלים item (groups the ציוד משלים table). Only the changed rows are sent.
 */
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { Spinner } from "@gdud/ui";
import { saveCategories } from "../../_actions/catalog";

export interface CategoryItem {
  id: string;
  name: string;
  serial: boolean;
  category: string | null;
}

const TOAST_MS = 4000;

export function CategoriesEditor({ items }: { items: CategoryItem[] }) {
  const router = useRouter();
  const listId = useId();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [toast, setToast] = useState<string>();
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const value = (i: CategoryItem) => draft[i.id] ?? i.category ?? "";
  const known = [...new Set(items.map(value).map((c) => c.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "he"));
  const changed = items.filter((i) => draft[i.id] !== undefined && (draft[i.id]!.trim() || null) !== i.category);

  function save() {
    setError(undefined);
    if (!changed.length) return;
    start(async () => {
      const r = await saveCategories({ rows: changed.map((i) => ({ itemId: i.id, category: draft[i.id] })) });
      if (!r.ok) return setError(r.error);
      setDraft({});
      setToast(`עודכנו ${r.data.changed} קטגוריות`);
      router.refresh();
    });
  }

  const group = (title: string, list: CategoryItem[]) =>
    list.length ? (
      <section className="flex flex-col gap-1.5" aria-label={title}>
        <h3 className="tz-section-header">{title}</h3>
        <div className="tz-group">
          {list.map((i) => (
            <label key={i.id} className="tz-row">
              <span className="tz-row-body">
                <span className="tz-row-title text-[15px]">{i.name}</span>
                <input
                  className="tz-input min-h-8 w-[180px] py-0"
                  value={value(i)}
                  maxLength={40}
                  list={listId}
                  placeholder="ללא קטגוריה"
                  onChange={(e) => setDraft((d) => ({ ...d, [i.id]: e.target.value }))}
                  aria-label={`קטגוריה של ${i.name}`}
                  disabled={pending}
                />
              </span>
            </label>
          ))}
        </div>
      </section>
    ) : null;

  return (
    <div className="flex flex-col gap-3">
      <datalist id={listId}>
        {known.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      {group("סוגי מכשירים — סדר הדוח לחטיבה", items.filter((i) => i.serial))}
      {group("ציוד משלים — קבוצות בטבלת ציוד משלים", items.filter((i) => !i.serial))}
      {error ? (
        <p role="alert" className="tz-alert tz-alert-error m-0 whitespace-pre-line">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2 px-1">
        <button type="button" className="tz-btn tz-btn-filled tz-btn-sm" onClick={save} disabled={pending || !changed.length} aria-busy={pending || undefined}>
          {pending ? <Spinner size={14} /> : null}
          שמירת קטגוריות{changed.length ? ` (${changed.length})` : ""}
        </button>
      </div>
      {toast ? (
        <div className="tz-toast lg:bottom-6" role="status">
          <span>{toast}</span>
        </div>
      ) : null}
    </div>
  );
}
