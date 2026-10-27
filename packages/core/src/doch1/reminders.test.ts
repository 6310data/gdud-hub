import { expect, it } from "vitest";
import { arrivalReminderMessages, isDue, reminderMessages } from "./reminders";

it("isDue only after the reminder time and once a day", () => {
  expect(isDue(new Date("2026-10-22T05:59:00Z"), "09:00", false)).toBe(false); // 08:59 Israel
  expect(isDue(new Date("2026-10-22T06:01:00Z"), "09:00", false)).toBe(true);
  expect(isDue(new Date("2026-10-22T06:01:00Z"), "09:00", true)).toBe(false);
});

it("isDue accepts a database time with seconds", () => expect(isDue(new Date("2026-10-22T06:00:00Z"), "09:00:00", false)).toBe(true));

it("messages carry counts and unit names, never soldiers, and skip complete units", () => {
  const msgs = reminderMessages(
    [
      { userId: "u1", scopeUnitId: "plsr", scopeName: "פלס״ר" },
      { userId: "u2", scopeUnitId: "plnt", scopeName: "פלנ״ט" },
    ],
    new Map([
      ["plsr", 9],
      ["plnt", 0],
    ]),
  );
  expect(msgs).toEqual([{ userId: "u1", unitId: "plsr", missing: 9, title: "דוח 1", body: "פלס״ר · חסרים 9 דיווחים להיום", url: "/doch1/today?unit=plsr" }]);
});

it("a unit with no count is skipped", () =>
  expect(reminderMessages([{ userId: "u1", scopeUnitId: "x", scopeName: "x" }], new Map())).toEqual([]));

it("the צפי הגעה reminder says how many are not filled, per unit, and links to the planning screen", () => {
  const msgs = arrivalReminderMessages(
    [
      { userId: "u1", scopeUnitId: "plsr", scopeName: "פלס״ר" },
      { userId: "u2", scopeUnitId: "plnt", scopeName: "פלנ״ט" },
    ],
    new Map([["plsr", 12]]),
  );
  expect(msgs).toEqual([{ userId: "u1", unitId: "plsr", missing: 12, title: "דוח 1 · תכנון סבב", body: "פלס״ר · חסר צפי הגעה ל־12 חיילים", url: "/doch1/planning?unit=plsr" }]);
});
