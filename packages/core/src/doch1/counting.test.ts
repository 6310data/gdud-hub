import { describe, expect, it } from "vitest";
import {
  fillFromYesterdayPlan,
  inService,
  inServiceBetween,
  missingMembers,
  planBulkWrite,
  statusFlagsChanged,
  summarize,
  type ReportMember,
  type StatusDef,
  type StatusFlags,
} from "./counting";

const NO_FLAGS: StatusFlags = {
  countsInSadak: false,
  countsAsPresent: false,
  homeDay: false,
  orgDay: false,
  generalDay: false,
  offDuty: false,
  acrossBorder: false,
  needsOutpost: false,
};
const status = (id: string, displayGroup: string, sortOrder: number, flags: Partial<StatusFlags>, color = "#7a8699"): StatusDef => ({
  ...NO_FLAGS,
  ...flags,
  id,
  name: id,
  color,
  displayGroup,
  sheetValue: id,
  sortOrder,
  active: true,
});

const statuses: StatusDef[] = [
  status("A", "עזה", 1, { countsInSadak: true }, "#e07b2e"),
  status("B", "אחר", 5, { countsInSadak: true }),
  status("C", "עזה", 3, { countsInSadak: true }, "#111111"),
  status("Z", "לא בשמ״פ", 9, { offDuty: true }),
];
const member = (personId: string, inReport = true): ReportMember => ({ personId, companyId: "c1", platoonId: null, inReport });
const members = [member("m1"), member("m2"), member("m3"), member("m4", false)];

describe("summarize", () => {
  it("counts by flags and display group, not names", () => {
    const s = summarize(members, new Map([["m1", "A"], ["m2", "C"], ["m4", "B"]]), statuses);
    expect(s).toMatchObject({ roster: 3, reported: 2, missing: 1, inSadak: 2, offDuty: 0 });
    expect(s.groups).toEqual([{ name: "עזה", color: "#e07b2e", count: 2 }]);
    expect(s.completion).toBeCloseTo(2 / 3);
  });

  it("off-duty is reported, not missing, and not in סד״כ", () => {
    const s = summarize(members, new Map([["m1", "Z"], ["m2", "A"], ["m3", "A"]]), statuses);
    expect(s).toMatchObject({ reported: 3, missing: 0, inSadak: 2, offDuty: 1 });
  });

  it("orders groups by their lowest sort order", () => {
    const s = summarize(members, new Map([["m1", "B"], ["m2", "C"], ["m3", "B"]]), statuses);
    expect(s.groups.map((g) => [g.name, g.count])).toEqual([["עזה", 1], ["אחר", 2]]);
  });

  it("an empty roster is complete", () => {
    expect(summarize([], new Map(), statuses)).toMatchObject({ roster: 0, missing: 0, completion: 1 });
  });

  it("renaming a status does not change the counts", () => {
    const renamed = statuses.map((s) => (s.id === "A" ? { ...s, name: "שם אחר" } : s));
    const day = new Map([["m1", "A"], ["m2", "C"]]);
    expect(summarize(members, day, renamed)).toEqual(summarize(members, day, statuses));
  });
});

it("missingMembers lists in-report members without an entry", () =>
  expect(missingMembers(members, new Map([["m1", "A"]])).map((m) => m.personId)).toEqual(["m2", "m3"]));

it("fill from yesterday only touches today's missing", () =>
  expect(fillFromYesterdayPlan(members, new Map([["m1", "A"]]), new Map([["m1", "B"], ["m2", "B"], ["m4", "A"]])))
    .toEqual([{ personId: "m2", statusId: "B" }]));

it("planBulkWrite keeps an exact undo", () => {
  const r = planBulkWrite(new Map([["m1|2026-10-23", "B"], ["m1|2026-10-24", "A"]]), ["m1"], ["2026-10-23", "2026-10-24", "2026-10-25"], "A");
  expect(r.writes.map((w) => w.day)).toEqual(["2026-10-23", "2026-10-25"]);
  expect(r.writes.every((w) => w.statusId === "A" && w.personId === "m1")).toBe(true);
  expect(r.undo).toEqual([
    { personId: "m1", day: "2026-10-23", statusId: "B" },
    { personId: "m1", day: "2026-10-25", statusId: null },
  ]);
  expect(r.overwritten).toBe(1);
});

describe("statusFlagsChanged", () => {
  const a = statuses[0]!;
  it("is true when any flag differs", () => {
    expect(statusFlagsChanged(a, { ...a, offDuty: true })).toBe(true);
    expect(statusFlagsChanged(a, { ...a, needsOutpost: true })).toBe(true);
  });
  it("is false when only name, color or group differ", () => {
    const renamed: StatusDef = { ...a, name: "x", color: "#000000", displayGroup: "y" };
    expect(statusFlagsChanged(a, renamed)).toBe(false);
  });
});

describe("inService", () => {
  const m = { callUpOn: "2026-09-06", releasedOn: "2026-10-20", arriving: true };
  it("lists a soldier from the call-up date through the release date", () => {
    expect(inService(m, "2026-09-05")).toBe(false);
    expect(inService(m, "2026-09-06")).toBe(true);
    expect(inService(m, "2026-10-20")).toBe(true);
    expect(inService(m, "2026-10-21")).toBe(false);
    expect(inService({ ...m, releasedOn: null }, "2026-12-10")).toBe(true);
  });
  it("never lists a soldier without a call-up date", () => {
    expect(inService({ callUpOn: null, releasedOn: null, arriving: true }, "2026-10-20")).toBe(false);
    expect(inServiceBetween({ callUpOn: null, releasedOn: null, arriving: true }, "2026-08-23", "2026-12-10")).toBe(false);
  });
  it("never lists a soldier marked not arriving, whatever the dates", () => {
    expect(inService({ ...m, arriving: false }, "2026-09-10")).toBe(false);
    expect(inServiceBetween({ ...m, arriving: false }, "2026-08-23", "2026-12-10")).toBe(false);
  });
  it("inServiceBetween is true when any day of the range is listed", () => {
    expect(inServiceBetween(m, "2026-08-30", "2026-09-06")).toBe(true);
    expect(inServiceBetween(m, "2026-08-30", "2026-09-05")).toBe(false);
    expect(inServiceBetween(m, "2026-10-20", "2026-10-30")).toBe(true);
    expect(inServiceBetween(m, "2026-10-21", "2026-10-30")).toBe(false);
  });
});
