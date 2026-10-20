import Link from "next/link";
import { notFound } from "next/navigation";
import { withUser } from "@gdud/db";
import { Field } from "@gdud/ui";
import { ActionForm } from "@/components/action-form";
import { logisticsAccess } from "@/lib/logistics/access";
import { loadItems } from "@/lib/logistics/data";
import { requireModule } from "@/lib/session";
import { addItem } from "../../_actions/stock";
import { PageHeader } from "../../_components/ui";

export const metadata = { title: "פריט חדש" };

export default async function NewItemPage() {
  const s = await requireModule("logistics");
  if (!logisticsAccess(s).isStockAdmin) notFound();
  const items = await withUser(s.claims, (tx) => loadItems(tx));
  const categories = [...new Set(items.map((i) => i.category).filter(Boolean))] as string[];
  const subs = [...new Set(items.map((i) => i.subcategory).filter(Boolean))] as string[];

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4">
      <Link href="/logistics/stock" className="tz-btn tz-btn-plain self-start px-0">
        ‹ מחסן
      </Link>
      <PageHeader title="פריט חדש" sub="הפריט יופיע ברשימות הבחירה של המחסן וההחתמה" />
      <div className="tz-card">
        <ActionForm action={addItem} submitLabel="שמירה">
          <Field label="שם הפריט">
            <input name="name" required maxLength={80} className="tz-input" placeholder="כמו שיופיע ברשימה, למשל M4 קצר" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="קטגוריה">
              <input name="category" list="item-categories" maxLength={60} className="tz-input" placeholder="נשק, אופטיקה…" />
            </Field>
            <Field label="תת קטגוריה">
              <input name="subcategory" list="item-subs" maxLength={60} className="tz-input" placeholder="כוונות…" />
            </Field>
          </div>
          <Field label="מק״ט (לא חובה)">
            <input name="sku" maxLength={40} dir="ltr" className="tz-input" />
          </Field>
          <datalist id="item-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <datalist id="item-subs">
            {subs.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </ActionForm>
      </div>
    </div>
  );
}
