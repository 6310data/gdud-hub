import { describe, expect, it } from "vitest";
import { accessibleModules, can, safeNextPath, scopesFor, type AppUser } from "./index";

// גדוד ← פלס״ר ← מחלקה 1 ; גדוד ← פלנ״ט
const parents = new Map<string, string | null>([
  ["bat", null],
  ["plsr", "bat"],
  ["plsr-1", "plsr"],
  ["plnt", "bat"],
]);

const user = (memberships: AppUser["memberships"], isSuperAdmin = false): AppUser => ({
  id: "u1",
  email: "a@b.c",
  displayName: null,
  isSuperAdmin,
  memberships,
});

describe("can()", () => {
  const clerk = user([
    { module: "doch1", role: "company_user", unitId: "plsr" },
    { module: "logistics", role: "viewer", unitId: "plsr" },
  ]);

  it("allows the clerk's own company and everything below it", () => {
    expect(can(clerk, "doch1", ["company_user"], "plsr", parents)).toBe(true);
    expect(can(clerk, "doch1", ["company_user"], "plsr-1", parents)).toBe(true);
  });

  it("blocks other companies", () => {
    expect(can(clerk, "doch1", ["company_user"], "plnt", parents)).toBe(false);
  });

  it("blocks battalion-level resources for unit-scoped users", () => {
    expect(can(clerk, "doch1", "any", null, parents)).toBe(false);
  });

  it("checks the role, not just the module", () => {
    expect(can(clerk, "logistics", ["admin"], "plsr", parents)).toBe(false);
    expect(can(clerk, "logistics", ["viewer"], "plsr", parents)).toBe(true);
  });

  it("module-level check passes with any scoped membership", () => {
    expect(can(clerk, "doch1", "any")).toBe(true);
    expect(can(clerk, "kesher", "any")).toBe(false);
  });

  it("battalion-wide membership covers every unit", () => {
    const admin = user([{ module: "doch1", role: "admin", unitId: null }]);
    expect(can(admin, "doch1", ["admin"], "plnt", parents)).toBe(true);
    expect(can(admin, "doch1", ["admin"], null, parents)).toBe(true);
  });

  it("super admin can do everything", () => {
    const su = user([], true);
    expect(can(su, "kesher", ["admin"], "plnt", parents)).toBe(true);
  });

  it("no user → no access", () => {
    expect(can(null, "core", "any")).toBe(false);
  });
});

describe("accessibleModules()", () => {
  it("lists only modules with a membership", () => {
    const u = user([{ module: "doch1", role: "viewer", unitId: null }]);
    expect(accessibleModules(u).map((m) => m.id)).toEqual(["doch1"]);
  });
});

describe("scopesFor()", () => {
  it("returns the units for matching roles", () => {
    const u = user([
      { module: "doch1", role: "company_user", unitId: "plsr" },
      { module: "doch1", role: "viewer", unitId: null },
    ]);
    expect(scopesFor(u, "doch1", ["company_user"])).toEqual(["plsr"]);
    expect(scopesFor(u, "doch1")).toEqual(["plsr", null]);
  });
});

describe("safeNextPath()", () => {
  it("keeps relative paths", () => expect(safeNextPath("/doch1?d=1")).toBe("/doch1?d=1"));
  it("rejects absolute and protocol-relative URLs", () => {
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
  });
});
