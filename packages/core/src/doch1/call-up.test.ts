import { describe, expect, it } from "vitest";
import { callUpBrigadeText, callUpSummary, inCallUp, type CallUpMember } from "./call-up";

const DAY = "2026-09-06";
const m = (personId: string, companyId: string, extra: Partial<CallUpMember> = {}): CallUpMember => ({
  personId,
  companyId,
  callUpOn: DAY,
  releasedOn: null,
  arriving: true,
  enlistment: null,
  enlistmentOptionId: null,
  ...extra,
});

const members: CallUpMember[] = [
  m("a1", "a", { enlistment: "arrived", enlistmentOptionId: "o-arrived" }),
  m("a2", "a", { enlistment: "arrived", enlistmentOptionId: "o-arrived" }),
  m("a3", "a", { enlistment: "pending", enlistmentOptionId: "o-pending" }),
  m("a4", "a"), // nothing marked yet
  m("a5", "a", { callUpOn: "2026-09-20", enlistment: "postponed", enlistmentOptionId: "o-postponed" }),
  m("b1", "b", { enlistment: "released", enlistmentOptionId: "o-released", releasedOn: DAY }),
  m("b2", "b", { enlistment: "arrived", enlistmentOptionId: "o-arrived" }),
  m("b3", "b", { arriving: false }), // not arriving: not part of the call-up
  m("b4", "b", { callUpOn: "2026-09-20" }), // called up later, nothing marked
];

describe("inCallUp", () => {
  it("is everyone arriving who was called up by that day, or already has a value", () => {
    expect(members.filter((x) => inCallUp(x, DAY)).map((x) => x.personId)).toEqual(["a1", "a2", "a3", "a4", "a5", "b1", "b2"]);
  });
});

describe("callUpSummary", () => {
  const s = callUpSummary(members, DAY);

  it("counts per company: postponed and released leave the expected count; blank counts as pending", () => {
    expect(s.byCompany.get("a")).toMatchObject({ called: 5, expected: 4, arrived: 2, pending: 2, postponed: 1, released: 0, percent: 50 });
    expect(s.byCompany.get("b")).toMatchObject({ called: 2, expected: 1, arrived: 1, pending: 0, postponed: 0, released: 1, percent: 100 });
  });

  it("totals the battalion and counts each value", () => {
    expect(s.total).toMatchObject({ called: 7, expected: 5, arrived: 3, percent: 60 });
    expect(s.total.byOption.get("o-arrived")).toBe(3);
    expect(s.total.byOption.get(null)).toBe(1);
  });

  it("percent is null when nobody is expected", () => {
    expect(callUpSummary([], DAY).total.percent).toBeNull();
  });
});

describe("callUpBrigadeText", () => {
  const s = callUpSummary(members, DAY);
  const text = callUpBrigadeText({
    battalionName: "גדס״ר",
    day: DAY,
    total: s.total,
    companies: [
      { name: "אגם", summary: s.byCompany.get("a")! },
      { name: "מסייעת", summary: s.byCompany.get("b")! },
    ],
  });

  it("matches the format", () => {
    expect(text).toBe(
      [
        "*גדס״ר – יום גיוס · יום א׳ 06.09*",
        "התייצבו: 3 מתוך 5 (60%)",
        "טרם התייצבו 2 · נדחו 1",
        "שוחררו 1",
        "*לפי פלוגה (התייצבו / צפויים)*",
        "אגם 2 / 4 (50%) · מסייעת 1 / 1 (100%)",
      ].join("\n"),
    );
  });

  it("carries no names or ids", () => {
    for (const x of members) expect(text).not.toContain(x.personId);
  });
});
