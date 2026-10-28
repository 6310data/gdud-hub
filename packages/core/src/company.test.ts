import { describe, expect, it } from "vitest";
import { countDays, formatPhone, isCompanyGrantable, normalizePhone, type RoundDay } from "./company";

describe("normalizePhone()", () => {
  it("keeps digits and turns +972 into 0", () => {
    expect(normalizePhone("050-123 4567")).toBe("0501234567");
    expect(normalizePhone("+972 50 123 4567")).toBe("0501234567");
    expect(normalizePhone("02-6234567")).toBe("026234567");
  });

  it("rejects what isn't a phone number", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("5012345678")).toBeNull();
    expect(normalizePhone("050123456789")).toBeNull();
  });
});

describe("formatPhone()", () => {
  it("adds the dash for display", () => {
    expect(formatPhone("0501234567")).toBe("050-1234567");
    expect(formatPhone("026234567")).toBe("02-6234567");
    expect(formatPhone(null)).toBe("");
  });
});

describe("countDays()", () => {
  const d = (day: string, flags: Partial<RoundDay> = {}): RoundDay => ({
    day,
    statusName: "x",
    color: "#000000",
    present: false,
    home: false,
    org: false,
    ...flags,
  });

  it("counts days up to today by flag, and later days as planned only", () => {
    const days = [
      d("2026-10-01", { present: true }),
      d("2026-10-02", { present: true }),
      d("2026-10-03", { home: true }),
      d("2026-10-04", { org: true }),
      d("2026-10-05"),
      d("2026-10-06", { present: true }),
      d("2026-10-07", { home: true }),
    ];
    expect(countDays(days, "2026-10-06")).toEqual({ present: 3, home: 1, org: 1, other: 1, planned: 1 });
  });

  it("is all zero with no days", () => {
    expect(countDays([], "2026-10-06")).toEqual({ present: 0, home: 0, org: 0, other: 0, planned: 0 });
  });
});

describe("isCompanyGrantable()", () => {
  it("allows the whitelist on its level only, never an admin role", () => {
    expect(isCompanyGrantable("doch1", "company_user", "company")).toBe(true);
    expect(isCompanyGrantable("doch1", "platoon_commander", "platoon")).toBe(true);
    expect(isCompanyGrantable("doch1", "platoon_commander", "company")).toBe(false);
    expect(isCompanyGrantable("kesher", "user", "platoon")).toBe(false);
    expect(isCompanyGrantable("doch1", "admin", "company")).toBe(false);
    expect(isCompanyGrantable("company", "admin", "company")).toBe(false);
  });
});
