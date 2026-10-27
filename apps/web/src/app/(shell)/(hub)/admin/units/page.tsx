import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@gdud/auth";
import { sortAsTree, UNIT_KIND_LABEL, UNIT_KINDS } from "@gdud/core";
import { Chip, Field, LargeTitle, Row, Section } from "@gdud/ui";
import { ActionButton } from "@/components/action-button";
import { ActionForm } from "@/components/action-form";
import { requireSession } from "@/lib/session";
import { createUnit, setUnitActive, setUnitColor } from "../actions";

export const metadata = { title: "מבנה הגדוד" };

export default async function UnitsPage() {
  const { user, units } = await requireSession();
  if (!can(user, "core", ["admin"], null)) notFound();

  const tree = sortAsTree(units);

  return (
    <>
      <Link href="/admin" className="tz-btn tz-btn-plain" style={{ paddingInline: 0 }}>
        ‹ ניהול מערכת
      </Link>
      <LargeTitle sub="הרשאות לפי מסגרת חלות על כל מה שמתחתיה">מבנה הגדוד</LargeTitle>

      <Section header={`מסגרות · ${units.length}`} footer="צבע הפלוגה מופיע בכל המחלקות: באריחים ובגוון בהיר בעמודות ובשורות של הפלוגה בטבלאות.">
        {tree.map((u) => (
          <Row
            key={u.id}
            leading={
              <span
                className="tz-tile"
                style={{ background: u.color ?? "var(--tile-neutral)", marginInlineStart: u.depth * 20 }}
              />
            }
            title={u.name}
            sub={[UNIT_KIND_LABEL[u.kind], u.code].filter(Boolean).join(" · ")}
            trailing={
              <>
                {!u.active ? <Chip tone="signed">לא פעיל</Chip> : null}
                {u.kind !== "battalion" ? (
                  <ActionForm action={setUnitColor} submitLabel="שמירת צבע" variant="plain" className="flex items-center gap-1">
                    <input type="hidden" name="unitId" value={u.id} />
                    <input
                      name="color"
                      type="color"
                      aria-label={`הצבע של ${u.name}`}
                      className="h-8 w-10 cursor-pointer rounded-md border-0 bg-transparent p-0"
                      defaultValue={u.color ?? "#7a8699"}
                    />
                  </ActionForm>
                ) : null}
                {u.kind !== "battalion" ? (
                  <ActionButton action={setUnitActive.bind(null, u.id, !u.active)} label={u.active ? "השבתה" : "הפעלה"} />
                ) : null}
              </>
            }
          />
        ))}
      </Section>

      <Section header="מסגרת חדשה" footer="קוד = מזהה קצר באנגלית לכתובות (למשל plsr). צבע = צבע הפלוגה בכל המערכת.">
        <ActionForm action={createUnit} submitLabel="הוספה">
          <Field label="שם">
            <input name="name" required className="tz-input" placeholder="פלס״ר" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="סוג">
              <select name="kind" className="tz-input" defaultValue="company">
                {UNIT_KINDS.filter((k) => k !== "battalion").map((k) => (
                  <option key={k} value={k}>
                    {UNIT_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="תחת">
              <select name="parentId" className="tz-input" required>
                {tree
                  .filter((u) => u.active && u.kind !== "team")
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {"  ".repeat(u.depth)}
                      {u.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="קוד">
              <input name="code" dir="ltr" className="tz-input" placeholder="plsr" pattern="[a-z0-9\-]{1,32}" />
            </Field>
            <Field label="צבע">
              <input name="color" type="color" className="tz-input" defaultValue="#1e3a5f" />
            </Field>
          </div>
        </ActionForm>
      </Section>
    </>
  );
}
