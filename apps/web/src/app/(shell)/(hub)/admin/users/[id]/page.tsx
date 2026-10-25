import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { can } from "@gdud/auth";
import { getModule, roleLabel, sortAsTree, UNIT_KIND_LABEL } from "@gdud/core";
import { eq, schema, withUser } from "@gdud/db";
import { Chip, LargeTitle, Row, Section } from "@gdud/ui";
import { ActionButton } from "@/components/action-button";
import { ActionForm } from "@/components/action-form";
import { requireSession } from "@/lib/session";
import { addMembership, removeMembership, setUserActive } from "../../actions";
import { MembershipFields } from "./membership-fields";

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, claims, units } = await requireSession();
  if (!can(user, "core", ["admin"], null) || !z.uuid().safeParse(id).success) notFound();

  const data = await withUser(claims, async (tx) => {
    const [target] = await tx.select().from(schema.appUsers).where(eq(schema.appUsers.id, id));
    if (!target) return null;
    const ms = await tx.select().from(schema.memberships).where(eq(schema.memberships.userId, id));
    return { target, ms };
  });
  if (!data) notFound();
  const { target, ms } = data;

  const unitName = new Map(units.map((u) => [u.id, u.name]));
  const unitOptions = sortAsTree(units.filter((u) => u.active && u.kind !== "battalion")).map((u) => ({
    id: u.id,
    label: `${u.name} (${UNIT_KIND_LABEL[u.kind]})`,
    depth: u.depth,
  }));
  const isSelf = target.id === user.id;
  const editable = !target.isSuperAdmin || user.isSuperAdmin;

  return (
    <>
      <Link href="/admin" className="tz-btn tz-btn-plain" style={{ paddingInline: 0 }}>
        ‹ ניהול מערכת
      </Link>
      <LargeTitle sub={<span className="tz-serial">{target.email}</span>}>{target.displayName ?? target.email}</LargeTitle>

      <Section header="סטטוס">
        <Row title="כניסה ראשונה" value={target.authUserId ? "בוצעה" : "טרם נכנס"} />
        <Row
          title="כניסה אחרונה"
          value={target.lastLoginAt ? target.lastLoginAt.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" }) : "—"}
        />
        <Row
          title="גישה"
          trailing={
            target.isSuperAdmin ? (
              <Chip tone="admin">מנהל על</Chip>
            ) : target.active ? (
              <Chip tone="ok">פעיל</Chip>
            ) : (
              <Chip tone="broken">מושבת</Chip>
            )
          }
        />
        {editable && !isSelf && !target.isSuperAdmin ? (
          <Row
            title={target.active ? "השבתת המשתמש" : "הפעלת המשתמש"}
            sub={target.active ? "המשתמש ינותק מכל המחלקות מיד" : undefined}
            trailing={
              <ActionButton
                action={setUserActive.bind(null, target.id, !target.active)}
                label={target.active ? "השבתה" : "הפעלה"}
                confirmLabel={target.active ? "לאשר השבתה" : undefined}
              />
            }
          />
        ) : null}
      </Section>

      <Section header="הרשאות" footer={target.isSuperAdmin ? "מנהל על רואה ועורך הכול, בלי קשר להרשאות." : undefined}>
        {ms.length === 0 ? <Row title={<span className="text-ink-muted">אין הרשאות</span>} /> : null}
        {ms.map((m) => (
          <Row
            key={m.id}
            title={`${getModule(m.module)?.name ?? m.module} · ${roleLabel(m.module, m.role)}`}
            sub={m.unitId ? (unitName.get(m.unitId) ?? "מסגרת לא ידועה") : "כל הגדוד"}
            trailing={
              editable ? (
                <ActionButton action={removeMembership.bind(null, m.id, target.id)} label="הסרה" confirmLabel="לאשר הסרה" />
              ) : undefined
            }
          />
        ))}
      </Section>

      {editable ? (
        <Section header="הוספת הרשאה" footer="הרשאה על פלוגה חלה גם על כל המחלקות והצוותים שמתחתיה.">
          <ActionForm action={addMembership} submitLabel="הוספה">
            <MembershipFields userId={target.id} units={unitOptions} />
          </ActionForm>
        </Section>
      ) : null}
    </>
  );
}
