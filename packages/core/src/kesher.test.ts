import { describe, expect, it } from "vitest";
import { checkStatus, expandKit, kesherLogKind, type KesherKitLine } from "./kesher";

describe("expandKit()", () => {
  const kits = new Map<string, KesherKitLine[]>([
    ["710", [{ item: "סוללות קטנות", qty: 4 }, { item: "מגבר", qty: 1 }]],
    ["מגבר", [{ item: "סוללות 91", qty: 2 }, { item: "BNC", qty: 1 }]],
  ]);

  it("multiplies by the count and follows a kit item's own תקן", () => {
    const out = expandKit(new Map([["710", 3]]), kits);
    expect(Object.fromEntries(out)).toEqual({ "סוללות קטנות": 12, "מגבר": 3, "סוללות 91": 6, BNC: 3 });
  });

  it("ignores items without a תקן", () => {
    expect(expandKit(new Map([["אולר", 5]]), kits).size).toBe(0);
  });

  it("stops a cycle at the depth limit", () => {
    const loop = new Map<string, KesherKitLine[]>([
      ["א", [{ item: "ב", qty: 1 }]],
      ["ב", [{ item: "א", qty: 1 }]],
    ]);
    const out = expandKit(new Map([["א", 1]]), loop);
    expect(out.get("ב")).toBe(2);
    expect(out.get("א")).toBe(2);
  });
});

describe("checkStatus()", () => {
  const now = new Date("2026-10-27T09:00:00Z");
  const ago = (d: number) => new Date(now.getTime() - d * 86_400_000);

  it("none, missing, stale and ok", () => {
    expect(checkStatus(null, now, 7).kind).toBe("none");
    expect(checkStatus({ at: ago(1), total: 10, found: 7 }, now, 7)).toEqual({ kind: "missing", missing: 3, days: 1 });
    expect(checkStatus({ at: ago(9), total: 10, found: 10 }, now, 7)).toEqual({ kind: "stale", missing: 0, days: 9 });
    expect(checkStatus({ at: ago(7), total: 10, found: 10 }, now, 7).kind).toBe("ok");
  });

  it("missing wins over stale", () => {
    expect(checkStatus({ at: ago(30), total: 4, found: 3 }, now, 7).kind).toBe("missing");
  });
});

describe("kesherLogKind()", () => {
  it("reads the old app's action texts", () => {
    expect(kesherLogKind("אתר — החתמה")).toEqual({ kind: "sign", backdated: false });
    expect(kesherLogKind("אתר — החתמה (מלאי חלקי) · תאריך 01/09/2026")).toEqual({ kind: "sign", backdated: true });
    expect(kesherLogKind("אתר — זיכוי · תאריך 02/09/2026")).toEqual({ kind: "credit", backdated: true });
    expect(kesherLogKind("אתר — שיוך בפלוגה").kind).toBe("assign");
    expect(kesherLogKind("אתר — קליטה ראשונית").kind).toBe("intake");
    expect(kesherLogKind("זיכוי").kind).toBe("credit");
  });

  it("anything else is legacy", () => {
    expect(kesherLogKind("סנכרון").kind).toBe("legacy");
    expect(kesherLogKind("").kind).toBe("legacy");
  });
});
