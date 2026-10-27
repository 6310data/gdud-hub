import { describe, expect, it } from "vitest";
import type { StatusDef, StatusFlags } from "./counting";
import { buildReports, categoriesFromData, categoryIndex, dataChecks, groupIndex, personalNumberKey, type ReportInput, type ReportSoldier } from "./reports";

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
const status = (id: string, sortOrder: number, flags: Partial<StatusDef>): StatusDef => ({
  ...NO_FLAGS,
  id,
  name: id,
  color: "#7a8699",
  displayGroup: id,
  sheetValue: id,
  sortOrder,
  active: true,
  ...flags,
});

// Invented names: the logic must not care what they are.
const statuses: StatusDef[] = [
  status("Gaza", 1, { countsInSadak: true, needsOutpost: true, acrossBorder: true, standbyAvailable: true }),
  status("Forest", 2, { countsInSadak: true, standbyAvailable: true, locationId: "camp" }),
  // an older version of Forest (its flags changed): still counts for the days that use it
  { ...status("Forest", 2, { countsInSadak: true, locationId: "camp" }), id: "ForestOld", active: false },
  status("Home", 3, { homeDay: true }),
  status("Org", 4, { orgDay: true }),
  status("Zero", 9, { offDuty: true }),
];

const DAY = "2026-10-19";
const soldier = (personId: string, companyId: string, platoonId: string | null, extra: Partial<ReportSoldier> = {}): ReportSoldier => ({
  personId,
  companyId,
  platoonId,
  inReport: true,
  callUpOn: "2026-09-06",
  releasedOn: null,
  locationId: null,
  dmhCategory: null,
  arrivalForecast: "מגיע מלא",
  personalNumber: `81${personId.replace(/\D/g, "").padStart(5, "0")}`,
  ...extra,
});

const soldiers: ReportSoldier[] = [
  soldier("a1", "c1", "p1", { locationId: "o131", dmhCategory: "קצין", personalNumber: "8123456" }),
  soldier("a2", "c1", "p1", { locationId: "o131", dmhCategory: "לוחם" }), // at an outpost, at home today
  soldier("a3", "c1", "p2", { dmhCategory: "מט״ב" }), // needs an outpost, has none
  soldier("a4", "c1", null, { locationId: "outside" }), // in the camp by status (old version)
  soldier("a5", "c1", null, { locationId: "o123" }), // at an outpost, not on duty today
  soldier("a6", "c1", null, { arrivalForecast: null, personalNumber: null }), // no report
  soldier("a7", "c2", "p3", { locationId: "camp", dmhCategory: "נהג", personalNumber: "08123456" }),
  soldier("a8", "c2", "p3", { locationId: "o123", callUpOn: null, arrivalForecast: " " }), // not called up
  soldier("a9", "c2", "p3", { locationId: "o131", inReport: false, arrivalForecast: null }), // לא נספר בדוח
  soldier("a10", "c2", "p3", { releasedOn: "2026-10-01", arrivalForecast: null }), // released
];

const dayStatuses = new Map([
  ["a1", "Gaza"],
  ["a2", "Home"],
  ["a3", "Gaza"],
  ["a4", "ForestOld"],
  ["a5", "Zero"],
  ["a7", "Forest"],
  ["a8", "Gaza"],
  ["a9", "Gaza"],
  ["a10", "Gaza"],
]);

const input: ReportInput = {
  day: DAY,
  soldiers,
  dayStatuses,
  statuses,
  companies: [
    { id: "c1", name: "פלוגה 1" },
    { id: "c2", name: "פלוגה 2" },
  ],
  locations: [
    { id: "o131", name: "מוצב א", kind: "outpost" },
    { id: "o123", name: "מוצב ב", kind: "outpost" },
    { id: "camp", name: "מחנה", kind: "camp" },
    { id: "outside", name: "בחוץ", kind: "outside" },
  ],
  categories: [
    { name: "קצין", listed: false },
    { name: "לוחם", listed: false },
    { name: 'מט"ב', listed: true },
    { name: "נהג", listed: false },
  ],
  groups: [
    { name: "כל פלוגה 2", commander: null, unitIds: ["c2"] },
    { name: "מסגרת 3", commander: "מ״מ 3", unitIds: ["p3"] },
    { name: "פלוגה 1", commander: null, unitIds: ["c1"] },
  ],
};

describe("buildReports", () => {
  const r = buildReports(input);

  it("R1: outpost rows count by שבצ״ק location whatever the status, camp rows by today's status", () => {
    expect(r.criticalRoles.columns).toEqual(["קצין", "לוחם", 'מט"ב', "נהג", "יתר"]);
    expect(r.criticalRoles.rows).toEqual([
      // a2 is home and a5 is off duty today — the sheet still counts them at their outposts
      { companyId: "c1", locationId: "o131", counts: [1, 1, 0, 0, 0], total: 2, acrossBorder: 2 },
      { companyId: "c1", locationId: "o123", counts: [0, 0, 0, 0, 1], total: 1, acrossBorder: 1 },
      // a4's שבצ״ק location is "outside"; the status puts them in the camp
      { companyId: "c1", locationId: "camp", counts: [0, 0, 0, 0, 1], total: 1, acrossBorder: 0 },
      // a8 (not called up) and a9 (not in the report) are left out; empty rows are hidden
      { companyId: "c2", locationId: "camp", counts: [0, 0, 0, 1, 0], total: 1, acrossBorder: 0 },
    ]);
    expect(r.criticalRoles.total).toEqual({ counts: [1, 1, 0, 1, 2], total: 5, acrossBorder: 3 });
  });

  it("15א: needs-outpost statuses by outpost, the gap is 'without an outpost'", () => {
    expect(r.outposts.outposts.map((l) => l.id)).toEqual(["o131", "o123"]);
    expect(r.outposts.camps.map((l) => l.id)).toEqual(["camp"]);
    expect(r.outposts.rows).toEqual([
      { companyId: "c1", outposts: [1, 0], needsOutpost: 2, noOutpost: 1, camps: [1], total: 3 },
      { companyId: "c2", outposts: [0, 0], needsOutpost: 0, noOutpost: 0, camps: [1], total: 1 },
    ]);
    expect(r.outposts.total).toEqual({ outposts: [1, 0], needsOutpost: 2, noOutpost: 1, camps: [2], total: 4 });
  });

  it("10א: the camp by report group — a מסגרת's group wins over its company's", () => {
    expect(r.camps).toHaveLength(1);
    expect(r.camps[0]!.rows).toEqual([
      { name: "כל פלוגה 2", commander: null, count: 0 },
      { name: "מסגרת 3", commander: "מ״מ 3", count: 1 },
      { name: "פלוגה 1", commander: null, count: 1 },
    ]);
    expect(r.camps[0]).toMatchObject({ unassigned: 0, total: 2 });
  });

  it("10א without groups: a row per company", () => {
    const camps = buildReports({ ...input, groups: [] }).camps[0]!;
    expect(camps.rows.map((x) => [x.name, x.count])).toEqual([
      ["פלוגה 1", 1],
      ["פלוגה 2", 1],
    ]);
  });

  it("10א: soldiers of a unit in no group are counted apart", () => {
    const camps = buildReports({ ...input, groups: [{ name: "רק 3", commander: null, unitIds: ["p3"] }] }).camps[0]!;
    expect(camps).toMatchObject({ unassigned: 1, total: 2 });
  });

  it("מט״בים: the listed category, spelling-insensitive, available by the status flag", () => {
    expect(r.listed).toEqual([{ personId: "a3", category: 'מט"ב', statusId: "Gaza", available: true }]);
  });

  it("data control per company (sheet section B)", () => {
    expect(r.control).toEqual([
      { companyId: "c1", rows: 6, offDuty: 1, missing: 1, onDuty: 4, noOutpost: 1, atOutpostOther: 2, inShabzak: 4 },
      { companyId: "c2", rows: 1, offDuty: 0, missing: 0, onDuty: 1, noOutpost: 0, atOutpostOther: 0, inShabzak: 1 },
    ]);
  });

  it("summary", () => {
    expect(r.summary).toEqual({
      onDuty: 5,
      inSector: 5,
      acrossBorder: 3,
      camps: [{ location: input.locations[2], count: 2 }],
      listedAvailable: 1,
      listedTotal: 1,
    });
  });

  it("סד״כ per מסגרת: needs-outpost by outpost, a column per status name, off duty in none", () => {
    expect(r.sadak.columns.outposts.map((l) => l.id)).toEqual(["o131", "o123"]);
    // Forest's two versions are one column; Org is active, so it has a column though nobody has it
    expect(r.sadak.columns.statuses).toEqual([
      { name: "Forest", ids: ["Forest", "ForestOld"] },
      { name: "Home", ids: ["Home"] },
      { name: "Org", ids: ["Org"] },
    ]);
    expect(r.sadak.rows).toEqual([
      { companyId: "c1", platoonId: "p1", outposts: [1, 0], noOutpost: 0, statuses: [0, 1, 0], missing: 0, total: 2 },
      { companyId: "c1", platoonId: "p2", outposts: [0, 0], noOutpost: 1, statuses: [0, 0, 0], missing: 0, total: 1 },
      { companyId: "c1", platoonId: null, outposts: [0, 0], noOutpost: 0, statuses: [1, 0, 0], missing: 1, total: 2 },
      { companyId: "c2", platoonId: "p3", outposts: [0, 0], noOutpost: 0, statuses: [1, 0, 0], missing: 0, total: 1 },
    ]);
    expect(r.sadak.total).toEqual({ outposts: [1, 0], noOutpost: 1, statuses: [2, 1, 0], missing: 1, total: 6 });
  });

  it("an unused inactive version has no column", () => {
    const r2 = buildReports({ ...input, dayStatuses: new Map([...dayStatuses, ["a4", "Forest"]]) });
    expect(r2.sadak.columns.statuses[0]).toEqual({ name: "Forest", ids: ["Forest"] });
  });
});

describe("dataChecks", () => {
  it("lists the soldiers of each check", () => {
    expect(dataChecks(input)).toEqual({
      missing: ["a6"],
      notInShabzak: ["a3"],
      outpostStatusNoOutpost: ["a3"],
      atOutpostOtherStatus: ["a2", "a5"],
      shabzakNotInRound: ["a8", "a9"],
      noForecast: ["a6", "a8"],
      duplicateNumber: ["a1", "a7"],
      noNumber: ["a6"],
    });
  });
});

describe("helpers", () => {
  it("categoriesFromData: texts in use, most used first, spelling variants merged, יתר and blanks left out", () => {
    expect(categoriesFromData(["לוחם", "קצין", 'מט"ב', "מט״ב", null, "", "יתר", "לוחם "])).toEqual([
      { name: "לוחם", listed: false },
      { name: 'מט"ב', listed: false },
      { name: "קצין", listed: false },
    ]);
  });

  it("categoryIndex: blank or unknown → the יתר column", () => {
    const cats = [{ name: "מפקד זוטר", listed: false }];
    expect(categoryIndex(cats, " מפקד  זוטר")).toBe(0);
    expect(categoryIndex(cats, null)).toBe(1);
    expect(categoryIndex(cats, "טבח")).toBe(1);
  });

  it("groupIndex: מסגרת first, then company, else -1", () => {
    const groups = [
      { name: "a", commander: null, unitIds: ["c1"] },
      { name: "b", commander: null, unitIds: ["p1"] },
    ];
    expect(groupIndex(groups, { companyId: "c1", platoonId: "p1" })).toBe(1);
    expect(groupIndex(groups, { companyId: "c1", platoonId: "p2" })).toBe(0);
    expect(groupIndex(groups, { companyId: "c9", platoonId: null })).toBe(-1);
  });

  it("personalNumberKey", () => {
    expect(personalNumberKey(" 08123456 ")).toBe("8123456");
    expect(personalNumberKey("")).toBeNull();
    expect(personalNumberKey(null)).toBeNull();
  });
});
