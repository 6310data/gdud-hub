/**
 * Module registry — the single list of departments ("mini apps") on the platform.
 *
 * Adding a department:
 *   1. Add an entry here (id, name, href, icon, roles).
 *   2. Add the id to the `module_id` enum in packages/db/src/schema/core.ts and generate a migration.
 *   3. Create apps/web/src/app/(shell)/<href>/ and its tables in packages/db/src/schema/<id>.ts.
 * The shell builds navigation and the admin "permissions" screen from this list.
 */

export type IconName = "home" | "gear" | "box" | "list" | "people" | "antenna";

export interface RoleDef {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

export interface ModuleDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly href: string;
  readonly icon: IconName;
  /** Roles a membership in this module can hold. Order = display order in admin UI. */
  readonly roles: readonly RoleDef[];
  /** Hidden from the launcher until the module is implemented. */
  readonly status: "live" | "planned";
}

export const MODULES = [
  {
    id: "logistics",
    name: "לוגיסטיקה",
    description: "החתמות, זיכויים ומלאי צ׳",
    href: "/logistics",
    icon: "box",
    status: "live",
    roles: [
      {
        id: "admin",
        label: "מנהל",
        description: "החתמה, זיכוי, אפסון ואלפון (במסגרת שלו); מלאי וקטלוג — כשההרשאה על כל הגדוד",
      },
      { id: "viewer", label: "צפייה", description: "חיפוש, צפייה והדפסת טפסים" },
    ],
  },
  {
    id: "doch1",
    name: "דוח 1",
    description: "מצבה יומית, שבצ״ק וכוננות",
    href: "/doch1",
    icon: "list",
    status: "planned",
    roles: [
      { id: "admin", label: "מנהל גדודי", description: "כל הפלוגות, דוחות והגדרות" },
      { id: "company_user", label: "משתמש פלוגה", description: "דוח 1, שבצ״ק וכוננות של הפלוגה שלו" },
      { id: "viewer", label: "צפייה", description: "סקירה ודוחות לקריאה בלבד" },
    ],
  },
  {
    id: "company",
    name: "ניהול פלוגה",
    description: "שגרת קו, משמרות וניהול פלוגה",
    href: "/company",
    icon: "people",
    status: "planned",
    roles: [
      { id: "admin", label: "מנהל", description: "שיבוץ, סבבים, לוגיסטיקה פלוגתית והגדרות" },
      { id: "user", label: "משתמש", description: "לוח שגרת קו ועדכון מצבה" },
    ],
  },
  {
    id: "kesher",
    name: "מחלקת קשר",
    description: "מלאי ציוד קשר והחתמות",
    href: "/kesher",
    icon: "antenna",
    status: "planned",
    roles: [
      { id: "admin", label: "מנהל", description: "החתמות, קליטה וניהול מלאי" },
      { id: "user", label: "משתמש", description: "חיפוש וצפייה" },
    ],
  },
  {
    id: "core",
    name: "ניהול מערכת",
    description: "משתמשים, הרשאות ומבנה הגדוד",
    href: "/admin",
    icon: "gear",
    status: "live",
    roles: [
      { id: "admin", label: "מנהל מערכת", description: "משתמשים, הרשאות ומסגרות" },
      { id: "editor", label: "עורך כוח אדם", description: "עריכת חיילים במסגרת שלו" },
    ],
  },
] as const satisfies readonly ModuleDef[];

export type ModuleId = (typeof MODULES)[number]["id"];

export type RoleOf<M extends ModuleId> = Extract<
  (typeof MODULES)[number],
  { id: M }
>["roles"][number]["id"];

export const MODULE_IDS = MODULES.map((m) => m.id) as unknown as readonly [ModuleId, ...ModuleId[]];

const byId = new Map<string, ModuleDef>(MODULES.map((m) => [m.id, m]));

export function getModule(id: string): ModuleDef | undefined {
  return byId.get(id);
}

export function isModuleId(id: string): id is ModuleId {
  return byId.has(id);
}

export function isRoleOf(module: ModuleId, role: string): boolean {
  return byId.get(module)?.roles.some((r) => r.id === role) ?? false;
}

export function roleLabel(module: string, role: string): string {
  return byId.get(module)?.roles.find((r) => r.id === role)?.label ?? role;
}
