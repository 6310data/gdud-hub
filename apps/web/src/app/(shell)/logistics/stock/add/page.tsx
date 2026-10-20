import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CONDITION_PLACE, LOGISTICS_CONDITIONS } from "@gdud/core";
import { withUser } from "@gdud/db";
import { Field } from "@gdud/ui";
import { ActionForm } from "@/components/action-form";
import { logisticsAccess } from "@/lib/logistics/access";
import { loadItems, loadSerials } from "@/lib/logistics/data";
import { requireModule } from "@/lib/session";
import { addSerials } from "../../_actions/stock";
import { PageHeader } from "../../_components/ui";

export const metadata = { title: "הוספת צ׳ים" };

export default async function AddSerialsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requireModule("logistics");
  if (!logisticsAccess(s).isStockAdmin) notFound();
  const { item } = z.object({ item: z.uuid().optional().catch(undefined) }).parse(await searchParams);

  const { items, serials } = await withUser(s.claims, async (tx) => ({ items: await loadItems(tx), serials: await loadSerials(tx) }));
  const chosen = items.find((i) => i.id === item);
  // suggest the category the item's serials already use (as in the old sheet's 'קטגוריה' column)
  const usedCategory = chosen ? serials.find((x) => x.itemId === chosen.id && x.category)?.category : undefined;
  const categories = [...new Set([...serials.map((x) => x.category), ...items.map((i) => i.subcategory)].filter(Boolean))] as string[];

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4">
      <Link href={chosen ? `/logistics/stock?item=${chosen.id}` : "/logistics/stock"} className="tz-btn tz-btn-plain self-start px-0">
        ‹ מחסן
      </Link>
      <PageHeader title="הוספת צ׳ים" sub={chosen ? chosen.name : "צ׳ים חדשים נכנסים למלאי הגדוד"} />
      {items.length === 0 ? (
        <div className="tz-card p-4 text-ink-muted">
          אין עדיין פריטים. <Link href="/logistics/stock/new">הוספת פריט חדש</Link>
        </div>
      ) : (
        <div className="tz-card">
          <ActionForm action={addSerials} submitLabel="שמירה">
            <Field label="פריט">
              <select name="itemId" required className="tz-input" defaultValue={chosen?.id ?? ""}>
                <option value="" disabled>
                  — בחרו פריט —
                </option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="קטגוריה (לא חובה)">
              <input name="category" list="serial-categories" maxLength={60} className="tz-input" defaultValue={usedCategory ?? chosen?.subcategory ?? ""} />
            </Field>
            <Field label="צ׳ים — אחד בכל שורה, או מופרדים בפסיק">
              <textarea name="serials" required rows={8} dir="ltr" className="tz-input tz-serial text-right" />
            </Field>
            <Field label="מצב">
              <select name="condition" className="tz-input" defaultValue="ok">
                {LOGISTICS_CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {CONDITION_PLACE[c]}
                  </option>
                ))}
              </select>
            </Field>
            <datalist id="serial-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </ActionForm>
        </div>
      )}
    </div>
  );
}
