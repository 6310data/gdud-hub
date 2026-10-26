import { describe, expect, it } from "vitest";
import type { StatusDef, StatusFlags } from "./counting";
import { addDays } from "./dates";
import { isWeekend, orgEntitlement, soldierRoundStats, soldierStrip } from "./soldier";

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
const status = (id: string, flags: Partial<StatusFlags>, sortOrder = 0, extra: Partial<StatusDef> = {}): StatusDef => ({
  ...NO_FLAGS,
  ...flags,
  id,
  name: id,
  color: "#7a8699",
  displayGroup: id,
  sheetValue: id,
  sortOrder,
  active: true,
  ...extra,
});

// like the sheet: עזה (שנספר), עיבוד (כללי only), רענון, התארגנות, 0 (שלא נספר)
const GAZA = status("gaza", { countsAsPresent: true, countsInSadak: true }, 1);
const WORK = status("work", { generalDay: true, countsInSadak: true }, 2);
const HOME = status("home", { homeDay: true, countsInSadak: true }, 3);
const ORG = status("org", { orgDay: true, countsInSadak: true }, 4);
const OFF = status("off", { offDuty: true }, 5);
const statuses = [GAZA, WORK, HOME, ORG, OFF];

/** consecutive days from `from`, one status id (or null = no entry) each */
const run = (from: string, ids: Array<string | null>) =>
  new Map(ids.flatMap((id, i) => (id ? [[addDays(from, i), id] as const] : [])));

describe("orgEntitlement (sheet CC)", () => {
  it("follows the sheet's table", () => {
    expect([0, 9, 10, 14, 15, 28, 29, 42, 43, 56, 57, 120].map(orgEntitlement)).toEqual([0, 0, 2, 2, 3, 3, 5, 5, 7, 7, 9, 9]);
  });
});

describe("isWeekend", () => {
  it("Friday and Saturday", () => {
    // 2026-10-23 is a Friday
    expect(["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"].map(isWeekend)).toEqual([false, true, true, false]);
  });
});

describe("soldierRoundStats", () => {
  const round = { startsOn: "2026-08-23", endsOn: "2026-12-10", callUpOn: "2026-09-06" };

  it("counts presence and home days from the call-up day; ימ״מ from the round start without התארגנות", () => {
    const days = new Map([
      ...run("2026-08-30", ["gaza", "work", "home", "org", "off"]), // before the call-up day
      ...run("2026-09-06", ["gaza", "gaza", "work", "home", "home", "org", "off", null]),
    ]);
    const s = soldierRoundStats(days, statuses, round, "2026-09-13");
    expect(s.presenceDays).toBe(2);
    expect(s.homeDays).toBe(2);
    expect(s.homeShare).toBe(0.5);
    // before the call-up: gaza, work, home = 3; from it: gaza ×2, work, home ×2 = 5
    expect(s.totalDays).toBe(8);
    expect(s.orgUsed).toBe(2);
    expect(s.orgEntitled).toBe(0);
  });

  it("without a call-up day, presence counts from the round start", () => {
    const s = soldierRoundStats(run("2026-08-23", ["gaza", "gaza"]), statuses, { ...round, callUpOn: null }, "2026-08-24");
    expect(s.presenceDays).toBe(2);
  });

  it("does not count planned days after today", () => {
    const s = soldierRoundStats(run("2026-09-06", ["gaza", "gaza", "gaza"]), statuses, round, "2026-09-07");
    expect(s.presenceDays).toBe(2);
  });

  it("home streak: days since the last other reported day, when the latest reported day is a home day", () => {
    const at = (ids: Array<string | null>, today: string) => soldierRoundStats(run("2026-09-06", ids), statuses, round, today).homeStreak;
    expect(at(["gaza", "home", "home", "home"], "2026-09-09")).toBe(3);
    expect(at(["gaza", "home", null, "home", null], "2026-09-10")).toBe(4); // gaps inside and today unreported
    expect(at(["home", "home", "gaza"], "2026-09-08")).toBe(0);
    expect(at(["gaza", null, null], "2026-09-08")).toBe(0);
    expect(at([], "2026-09-08")).toBe(0);
  });

  it("org days left: entitlement − (used − 0 / 0.5 / 1 for weekend org days)", () => {
    // 30 days of עזה → total 30 → entitled 5
    const base = run("2026-09-06", Array<string>(30).fill("gaza"));
    const withOrg = (orgDays: string[]) => new Map([...base, ...orgDays.map((d) => [d, "org"] as const)]);
    const today = "2026-10-20";
    expect(soldierRoundStats(withOrg(["2026-10-13", "2026-10-14"]), statuses, round, today)).toMatchObject({ orgEntitled: 5, orgUsed: 2, orgRemaining: 3 });
    // one on a Friday
    expect(soldierRoundStats(withOrg(["2026-10-15", "2026-10-16"]), statuses, round, today).orgRemaining).toBe(3.5);
    // Friday and Saturday
    expect(soldierRoundStats(withOrg(["2026-10-16", "2026-10-17", "2026-10-18"]), statuses, round, today).orgRemaining).toBe(3);
  });
});

describe("soldierStrip", () => {
  const round = { startsOn: "2026-08-23", endsOn: "2026-12-10" };
  const member = { callUpOn: "2026-10-02", releasedOn: null, inReport: true };

  it("missing only while listed in the report; legend by status order", () => {
    const days = run("2026-10-03", ["home", "gaza", null, "gaza"]);
    const { cells, legend, missing } = soldierStrip(days, statuses, member, round, "2026-10-01", "2026-10-06");
    expect(cells.map((c) => c.kind)).toEqual(["off", "missing", "status", "status", "missing", "status"]);
    expect(missing).toBe(2);
    expect(legend.map((l) => [l.name, l.count])).toEqual([
      ["gaza", 2],
      ["home", 1],
    ]);
  });

  it("a soldier out of the report has no missing days", () => {
    const { missing } = soldierStrip(new Map(), statuses, { ...member, inReport: false }, round, "2026-10-05", "2026-10-06");
    expect(missing).toBe(0);
  });

  it("versions of one status count together, in the current version's color", () => {
    const old = status("old", { countsAsPresent: true }, 1, { name: "עזה", active: false, color: "#000000" });
    const cur = status("cur", { countsAsPresent: true, countsInSadak: true }, 1, { name: "עזה", color: "#e07b2e" });
    const { legend } = soldierStrip(run("2026-10-03", ["old", "cur"]), [old, cur], member, round, "2026-10-03", "2026-10-04");
    expect(legend).toEqual([{ name: "עזה", color: "#e07b2e", count: 2 }]);
  });
});
