import { describe, expect, it } from "vitest";
import type { StatusDef } from "./counting";
import { availableStatusIds, locationChecks, missingRoles, roleMatches, swapCandidates, teamReadiness } from "./standby";

const status = (id: string, flags: Partial<StatusDef> = {}): StatusDef => ({
  id,
  name: id,
  color: "#7a8699",
  displayGroup: id,
  sheetValue: id,
  sortOrder: 0,
  active: true,
  countsInSadak: true,
  countsAsPresent: false,
  homeDay: false,
  orgDay: false,
  generalDay: false,
  offDuty: false,
  acrossBorder: false,
  needsOutpost: false,
  ...flags,
});

const gaza = status("gaza", { needsOutpost: true, standbyAvailable: true });
const camp = status("camp", { standbyAvailable: true });
const leaving = status("leaving");
const statuses = [gaza, camp, leaving];
const available = availableStatusIds(statuses);

describe("roleMatches", () => {
  it("ignores geresh/gershayim spelling and accepts '/' alternatives", () => {
    expect(roleMatches('מ"פ / סמ"פ', "סמ״פ")).toBe(true);
    expect(roleMatches("מ״פ / סמ״פ", "מ״פ")).toBe(true);
    expect(roleMatches("קשר", "קשר ")).toBe(true);
    expect(roleMatches("קשר", "נהג")).toBe(false);
    expect(roleMatches("קשר", null)).toBe(false);
  });
});

describe("missingRoles", () => {
  it("each member fills one role", () => {
    expect(missingRoles(["נהג", "נהג"], ["נהג"])).toEqual(["נהג"]);
    expect(missingRoles(["נהג", "חובש"], ["נהג", "חובש", "לוחם"])).toEqual([]);
  });
  it("fills the scarcer role first, so an alternative doesn't steal the only match", () => {
    // greedy in list order would give the סמ״פ to "מ״פ / סמ״פ" and leave "סמ״פ" missing
    expect(missingRoles(["מ״פ / סמ״פ", "סמ״פ"], ["סמ״פ", "מ״פ"])).toEqual([]);
  });
});

describe("teamReadiness", () => {
  const members = [
    { personId: "a", role: "סמ״פ" },
    { personId: "b", role: "קשר" },
    { personId: "c", role: "טילן" },
  ];
  const day = new Map([
    ["a", gaza.id],
    ["b", camp.id],
    ["c", leaving.id],
  ]);

  it("short when fewer available than the size", () => {
    const r = teamReadiness({ members, size: 3, requiredRoles: [], vehicleState: "ok", day, available });
    expect(r).toMatchObject({ available: 2, total: 3, needed: 3, state: "short" });
  });

  it("without a size, the team's own member count is needed", () => {
    expect(teamReadiness({ members, size: null, requiredRoles: [], vehicleState: null, day, available }).needed).toBe(3);
  });

  it("short when a required role has no available member, even with enough people", () => {
    const r = teamReadiness({ members, size: 2, requiredRoles: ["מ״פ / סמ״פ", "טילן"], vehicleState: "ok", day, available });
    expect(r.state).toBe("short");
    expect(r.missingRoles).toEqual(["טילן"]);
  });

  it("full only with the vehicle תקין; a missing report is not available", () => {
    expect(teamReadiness({ members, size: 2, requiredRoles: ["קשר"], vehicleState: "ok", day, available }).state).toBe("full");
    expect(teamReadiness({ members, size: 2, requiredRoles: [], vehicleState: "service", day, available }).state).toBe("vehicle");
    expect(teamReadiness({ members, size: 2, requiredRoles: [], vehicleState: null, day, available }).vehicleOk).toBe(true);
    expect(teamReadiness({ members, size: 2, requiredRoles: [], vehicleState: "ok", day: new Map(), available }).available).toBe(0);
  });
});

describe("swapCandidates", () => {
  it("leaves out soldiers on a team; available first, then the same role, then by name", () => {
    const day = new Map([
      ["x", gaza.id],
      ["y", gaza.id],
      ["z", leaving.id],
      ["w", camp.id],
    ]);
    const list = swapCandidates(
      "טילן",
      [
        { personId: "z", name: "זיו", role: "טילן", onTeam: false },
        { personId: "x", name: "בן", role: "לוחם", onTeam: false },
        { personId: "y", name: "גל", role: "טילן", onTeam: false },
        { personId: "w", name: "אבי", role: "טילן", onTeam: true },
      ],
      day,
      available,
    );
    expect(list.map((c) => c.personId)).toEqual(["y", "x", "z"]);
    expect(list[2]).toMatchObject({ available: false, sameRole: true });
  });
});

describe("locationChecks", () => {
  it("finds outpost statuses without an outpost and outpost soldiers in another status", () => {
    const day = new Map([
      ["a", gaza.id],
      ["b", camp.id],
      ["c", gaza.id],
      ["e", gaza.id],
    ]);
    const r = locationChecks(
      [
        { personId: "a", inReport: true, locationKind: "outside" },
        { personId: "b", inReport: true, locationKind: "outpost" },
        { personId: "c", inReport: true, locationKind: "outpost" },
        { personId: "d", inReport: true, locationKind: "outpost" }, // no report today: the missing list covers it
        { personId: "e", inReport: false, locationKind: null }, // out of the report
      ],
      day,
      statuses,
    );
    expect(r).toEqual({ outpostStatusWithoutOutpost: ["a"], atOutpostOtherStatus: ["b"] });
  });
});
