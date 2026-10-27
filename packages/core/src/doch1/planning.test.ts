import { describe, expect, it } from "vitest";
import { diffRoster, planningProgress, type RosterMember, type RosterRow } from "./planning";

const U = { plsr1: "u-plsr1", plsr2: "u-plsr2", plnt: "u-plnt" };

const row = (line: number, personalNumber: string, fullName: string, extra: Partial<RosterRow> = {}): RosterRow => ({
  line,
  personalNumber,
  fullName,
  company: "פלס״ר",
  platoon: "מחלקה 1",
  phone: null,
  role: null,
  ...extra,
});
const member = (personId: string, personalNumber: string | null, fullName: string, extra: Partial<RosterMember> = {}): RosterMember => ({
  personId,
  personalNumber,
  fullName,
  unitId: U.plsr1,
  phone: null,
  role: null,
  ...extra,
});
const unitOf = (r: RosterRow) =>
  r.company === "פלס״ר" ? (r.platoon === "מחלקה 2" ? U.plsr2 : U.plsr1) : r.company === "פלנ״ט" ? U.plnt : null;

describe("diffRoster", () => {
  const base = [
    member("p1", "1000001", "דנה בדויה"),
    member("p2", "1000002", "רון ממציא", { phone: "050-1234567" }),
    member("p3", "1000003", "טל דמיוני"),
    member("p4", null, "בלי מספר"),
  ];
  const known = new Map<string, RosterMember>([
    ...base.filter((m) => m.personalNumber).map((m) => [m.personalNumber!, m] as const),
    ["1000009", member("p9", "1000009", "חוזר מסבב קודם", { unitId: U.plnt })],
  ]);

  const diff = diffRoster({
    rows: [
      row(2, "1000001", "דנה  בדויה"), // same, spacing differs
      row(3, "1000002.0", "רון ממציא", { phone: "0501234567", platoon: "מחלקה 2", role: "נהג" }),
      row(4, "1000009", "חוזר מסבב קודם", { company: "פלנ״ט", platoon: "" }),
      row(5, "1000010", "חדשה לגמרי", { phone: "0529999999" }),
      row(6, "1000010", "חדשה לגמרי"), // twice in the file
      row(7, "12", "מספר שגוי"),
      row(8, "1000011", "פלוגה לא מוכרת", { company: "אחרת" }),
    ],
    base,
    known,
    unitOf,
  });

  it("puts each soldier in one group", () => {
    expect(diff.unchanged.map((x) => x.member.personId)).toEqual(["p1"]);
    expect(diff.changed.map((x) => x.member.personId)).toEqual(["p2"]);
    expect(diff.returning.map((x) => x.member.personId)).toEqual(["p9"]);
    expect(diff.added.map((x) => x.personalNumber)).toEqual(["1000010"]);
    expect(diff.missing.map((m) => m.personId).sort()).toEqual(["p3", "p4"]);
  });

  it("normalises personal numbers and resolves units", () => {
    expect(diff.changed[0]!.row.personalNumber).toBe("1000002");
    expect(diff.changed[0]!.row.unitId).toBe(U.plsr2);
    expect(diff.added[0]!.unitId).toBe(U.plsr1);
  });

  it("lists only the fields that differ; phones compare by digits", () => {
    expect(diff.changed[0]!.fields).toEqual(["unit", "role"]);
  });

  it("a blank value in the file is not a change", () => {
    const d = diffRoster({ rows: [row(2, "1000002", "רון ממציא", { phone: null })], base, known, unitOf });
    expect(d.unchanged.map((x) => x.member.personId)).toEqual(["p2"]);
  });

  it("reports duplicates, bad numbers and unknown units as problems, and doesn't add them", () => {
    expect(diff.problems.map((p) => p.line)).toEqual([6, 7, 8]);
    expect(diff.problems.every((p) => p.message.length > 0)).toBe(true);
  });

  it("a returning soldier carries the fields that differ too", () => {
    expect(diff.returning[0]!.fields).toEqual([]);
    const d = diffRoster({ rows: [row(2, "1000009", "חוזר מסבב קודם")], base: [], known, unitOf });
    expect(d.returning[0]!.fields).toEqual(["unit"]);
  });
});

describe("planningProgress", () => {
  it("counts per company and for the battalion; blank is its own count", () => {
    const p = planningProgress([
      { companyId: "a", arrival: "arriving" },
      { companyId: "a", arrival: "not_arriving" },
      { companyId: "a", arrival: null },
      { companyId: "b", arrival: "arriving" },
    ]);
    expect(p.get("a")).toEqual({ total: 3, arriving: 1, notArriving: 1, blank: 1 });
    expect(p.get("b")).toEqual({ total: 1, arriving: 1, notArriving: 0, blank: 0 });
    expect(p.get("all")).toEqual({ total: 4, arriving: 2, notArriving: 1, blank: 1 });
  });
});
