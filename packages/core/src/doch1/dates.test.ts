import { describe, expect, it } from "vitest";
import { addDays, dayRange, hebrewDayLabel, isDay, isDayWritable, israelClock, israelToday } from "./dates";

describe("israelToday", () => {
  it("rolls over at Israel midnight, not UTC midnight (summer time, UTC+3)", () => {
    expect(israelToday(new Date("2026-10-21T20:59:00Z"))).toBe("2026-10-21");
    expect(israelToday(new Date("2026-10-21T21:30:00Z"))).toBe("2026-10-22");
  });
  it("uses UTC+2 after DST ends on 25.10.2026", () => {
    expect(israelToday(new Date("2026-10-26T21:30:00Z"))).toBe("2026-10-26");
    expect(israelToday(new Date("2026-10-26T22:30:00Z"))).toBe("2026-10-27");
  });
});

it("israelClock", () => expect(israelClock(new Date("2026-10-22T06:59:00Z"))).toBe("09:59"));

it("israelClock is 00:xx right after midnight", () =>
  expect(israelClock(new Date("2026-10-21T21:30:00Z"))).toBe("00:30"));

it("addDays crosses months and goes backwards", () => {
  expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
});

it("dayRange is inclusive and crosses months", () =>
  expect(dayRange("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]));

it("dayRange is empty when to < from", () => expect(dayRange("2026-10-02", "2026-10-01")).toEqual([]));

it("isDay rejects impossible dates", () => {
  expect(isDay("2026-02-30")).toBe(false);
  expect(isDay("2026-10-22")).toBe(true);
  expect(isDay("2026-10-2")).toBe(false);
  expect(isDay(20261022)).toBe(false);
});

describe("isDayWritable", () => {
  const now = new Date("2026-10-22T06:59:00Z"); // 09:59 in Israel
  it("today before the lock", () => expect(isDayWritable({ day: "2026-10-22", now, lockAt: "10:00", isAdmin: false })).toBe(true));
  it("today after the lock", () =>
    expect(isDayWritable({ day: "2026-10-22", now: new Date("2026-10-22T07:01:00Z"), lockAt: "10:00:00", isAdmin: false })).toBe(false));
  it("future days are always open", () => expect(isDayWritable({ day: "2026-10-23", now, lockAt: "00:00", isAdmin: false })).toBe(true));
  it("past days only for admins", () => {
    expect(isDayWritable({ day: "2026-10-21", now, lockAt: "23:59", isAdmin: false })).toBe(false);
    expect(isDayWritable({ day: "2026-10-21", now, lockAt: "23:59", isAdmin: true })).toBe(true);
  });
  it("a save at 00:30 Israel time counts against the new day", () =>
    expect(isDayWritable({ day: "2026-10-22", now: new Date("2026-10-21T21:30:00Z"), lockAt: "10:00", isAdmin: false })).toBe(true));
});

it("hebrewDayLabel", () => expect(hebrewDayLabel("2026-10-19")).toBe("יום ב׳ 19.10"));
it("hebrewDayLabel on Saturday", () => expect(hebrewDayLabel("2026-10-24")).toBe("יום ש׳ 24.10"));
