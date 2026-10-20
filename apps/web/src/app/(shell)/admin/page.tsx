import Link from "next/link";
import { can } from "@gdud/auth";
import { getModule } from "@gdud/core";
import { asc, schema, withUser } from "@gdud/db";
import { Avatar, Chip, Field, LargeTitle, LinkRow, Section, Tile } from "@gdud/ui";
import { ActionForm } from "@/components/action-form";
import { requireModule } from "@/lib/session";
import { inviteUser } from "./actions";

export const metadata = { title: "ניהול מערכת" };

export default async function AdminPage() {
  const { user, claims } = await requireModule("core");

  if (!can(user, "core", ["admin"], null)) {
    return (
      <>
        <LargeTitle>ניהול מערכת</LargeTitle>
        <Section footer="עריכת כוח אדם תתווסף יחד עם מודול הלוגיסטיקה.">
          <div className="p-4 text-ink-muted">ניהול משתמשים והרשאות זמין למנהל מערכת גדודי בלבד.</div>
        </Section>
      </>
    );
  }

  const { users, memberships } = await withUser(claims, async (tx) => ({
    users: await tx.select().from(schema.appUsers).orderBy(asc(schema.appUsers.email)),
    memberships: await tx.select().from(schema.memberships),
  }));

  const modulesOf = (userId: string) =>
    [...new Set(memberships.filter((m) => m.userId === userId).map((m) => getModule(m.module)?.name ?? m.module))].join(" · ");

  return (
    <>
      <LargeTitle sub="משתמשים, הרשאות ומבנה הגדוד">ניהול מערכת</LargeTitle>

      <Section>
        <LinkRow
          as={Link}
          href="/admin/units"
          leading={<Tile icon="tree" color="neutral" />}
          title="מבנה הגדוד"
          sub="פלוגות, מחלקות וצוותים"
        />
      </Section>

      <Section header={`משתמשים · ${users.length}`}>
        {users.map((u) => (
          <LinkRow
            key={u.id}
            as={Link}
            href={`/admin/users/${u.id}`}
            leading={<Avatar name={u.displayName ?? u.email} />}
            title={u.displayName ?? u.email}
            sub={modulesOf(u.id) || (u.authUserId ? "ללא הרשאות" : "הוזמן · טרם נכנס")}
            trailing={
              u.isSuperAdmin ? (
                <Chip tone="admin">מנהל על</Chip>
              ) : !u.active ? (
                <Chip tone="broken">מושבת</Chip>
              ) : undefined
            }
          />
        ))}
      </Section>

      <Section header="הזמנת משתמש" footer="המשתמש ייכנס עם חשבון ה-Google של המייל הזה. אחרי ההזמנה, פתחו אותו כדי לתת הרשאות.">
        <ActionForm action={inviteUser} submitLabel="הזמנה">
          <Field label="מייל (Google)">
            <input name="email" type="email" required dir="ltr" className="tz-input" autoComplete="off" />
          </Field>
          <Field label="שם לתצוגה">
            <input name="displayName" className="tz-input" />
          </Field>
        </ActionForm>
      </Section>
    </>
  );
}
