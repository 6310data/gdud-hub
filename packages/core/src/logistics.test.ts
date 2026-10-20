import { describe, expect, it } from "vitest";
import {
  cleanKit,
  countStock,
  inArmory,
  isCondition,
  kitToString,
  lineTotals,
  matches,
  normalizeSerial,
  parseKitText,
  parseSerialList,
  pct,
  searchKey,
  sumCounts,
} from "./logistics";
import { ancestorOfKind, placement, type UnitNode } from "./units";

describe("normalizeSerial()", () => {
  it("drops spaces and hyphens like the sheet did", () => {
    expect(normalizeSerial(" 66-204 17 ")).toBe("6620417");
  });

  it("drops a trailing .0 left by number cells", () => {
    expect(normalizeSerial("4471203.0")).toBe("4471203");
    expect(normalizeSerial(4471203)).toBe("4471203");
  });

  it("keeps letters and dots inside a serial", () => {
    expect(normalizeSerial("AB.12")).toBe("AB.12");
  });

  it("returns empty for null/undefined", () => {
    expect(normalizeSerial(null)).toBe("");
    expect(normalizeSerial(undefined)).toBe("");
  });
});

describe("parseSerialList()", () => {
  it("splits on new lines, commas and semicolons, dedupes, keeps order", () => {
    expect(parseSerialList("111\n222, 333;111\n\n 44-4 ")).toEqual(["111", "222", "333", "444"]);
  });

  it("returns [] for blank input", () => {
    expect(parseSerialList(" \n , ")).toEqual([]);
  });
});

describe("search", () => {
  it("ignores spaces, quotes and gershayim", () => {
    expect(searchKey('פלס"ר')).toBe(searchKey("פלס״ר"));
    expect(matches("פלסר", "פלס״ר")).toBe(true);
  });

  it("matches any of the fields, and everything when the query is empty", () => {
    expect(matches("7745", "יוסי לוי", "7745213")).toBe(true);
    expect(matches("9999", "יוסי לוי", "7745213")).toBe(false);
    expect(matches("  ", "x")).toBe(true);
  });
});

describe("kit", () => {
  it("formats quantities before names and skips blanks", () => {
    expect(kitToString([{ name: "תוף", qty: 3 }, { name: "ערכת כולבו", qty: 1 }, { name: " ", qty: 2 }])).toBe(
      "3 תוף, ערכת כולבו",
    );
    expect(kitToString(null)).toBe("");
  });

  it("cleanKit merges duplicates, trims and clamps quantities", () => {
    expect(
      cleanKit([
        { name: " רצועה ", qty: 1 },
        { name: "רצועה", qty: 2 },
        { name: "", qty: 5 },
        { name: "מחסנית", qty: 500 },
        { name: "כיסוי", qty: 0 },
      ]),
    ).toEqual([
      { name: "רצועה", qty: 3 },
      { name: "מחסנית", qty: 99 },
      { name: "כיסוי", qty: 1 },
    ]);
  });

  it("cleanKit does not mutate its input", () => {
    const input = [{ name: "א", qty: 1 }, { name: "א", qty: 1 }];
    cleanKit(input);
    expect(input).toEqual([{ name: "א", qty: 1 }, { name: "א", qty: 1 }]);
  });

  it("parseKitText reads the kit column back (inverse of kitToString)", () => {
    expect(parseKitText("3 תופים, רצועה\nרצועה ,  ")).toEqual([
      { name: "תופים", qty: 3 },
      { name: "רצועה", qty: 2 },
    ]);
    expect(parseKitText("")).toEqual([]);
    const kit = [{ name: "תוף", qty: 3 }, { name: "ערכת כולבו", qty: 1 }];
    expect(parseKitText(kitToString(kit))).toEqual(kit);
  });
});

describe("stock counts", () => {
  const serials = [
    { itemId: "m4", condition: "ok" as const, held: false },
    { itemId: "m4", condition: "ok" as const, held: true },
    { itemId: "m4", condition: "broken" as const, held: false },
    { itemId: "m4", condition: "broken" as const, held: true }, // signed wins over condition
    { itemId: "nv", condition: "brigade" as const, held: false },
  ];

  it("counts signed separately from armory conditions", () => {
    const by = countStock(serials);
    expect(by.get("m4")).toEqual({ ok: 1, broken: 1, brigade: 0, signed: 2, total: 4 });
    expect(by.get("nv")).toEqual({ ok: 0, broken: 0, brigade: 1, signed: 0, total: 1 });
  });

  it("sums and derives armory totals", () => {
    const t = sumCounts(countStock(serials).values());
    expect(t).toEqual({ ok: 1, broken: 1, brigade: 1, signed: 2, total: 5 });
    expect(inArmory(t)).toBe(2);
  });

  it("pct is safe for 0 and rounds to one decimal", () => {
    expect(pct(1, 0)).toBe(0);
    expect(pct(1, 3)).toBe(33.3);
  });
});

describe("misc", () => {
  it("isCondition", () => {
    expect(isCondition("ok")).toBe(true);
    expect(isCondition("signed")).toBe(false);
    expect(isCondition(1)).toBe(false);
  });

  it("lineTotals groups per item in first-seen order", () => {
    expect(lineTotals([{ item: "M4" }, { item: "כוונת" }, { item: "M4" }])).toEqual([
      { item: "M4", count: 2 },
      { item: "כוונת", count: 1 },
    ]);
  });
});

describe("placement()", () => {
  const u = (id: string, parentId: string | null, kind: UnitNode["kind"]) => ({ id, parentId, kind });
  const byId = new Map(
    [u("bat", null, "battalion"), u("plsr", "bat", "company"), u("p1", "plsr", "platoon"), u("t1", "p1", "team")].map((x) => [
      x.id,
      x,
    ]),
  );

  it("finds company and platoon above a team", () => {
    const p = placement("t1", byId);
    expect(p.company?.id).toBe("plsr");
    expect(p.platoon?.id).toBe("p1");
  });

  it("soldier attached directly to a company has no platoon", () => {
    expect(placement("plsr", byId).platoon).toBeUndefined();
  });

  it("is cycle-safe and handles unknown ids", () => {
    const loop = new Map([
      ["a", u("a", "b", "team")],
      ["b", u("b", "a", "team")],
    ]);
    expect(ancestorOfKind("a", "company", loop)).toBeUndefined();
    expect(placement("nope", byId).company).toBeUndefined();
    expect(placement(null, byId).company).toBeUndefined();
  });
});
