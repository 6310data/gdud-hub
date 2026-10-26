import { describe, expect, it } from "vitest";
import { describeChange, type ChangeLookups } from "./changes";

const l: ChangeLookups = {
  status: (id) => ({ g: "עזה", h: "רענון" })[id],
  location: (id) => ({ m131: "מוצב 131" })[id],
  unit: (id) => ({ p1: "מחלקה 1", p2: "מחלקה 2" })[id],
};

describe("describeChange", () => {
  it("days: set, changed, cleared", () => {
    const row = (status_id: string) => ({ day: "2026-10-19", status_id, person_id: "x" });
    expect(describeChange({ table: "doch1_days", action: "insert", before: null, after: row("g") }, l)).toEqual(["19.10: עזה"]);
    expect(describeChange({ table: "doch1_days", action: "update", before: row("g"), after: row("h") }, l)).toEqual(["19.10: עזה ← רענון"]);
    expect(describeChange({ table: "doch1_days", action: "delete", before: row("h"), after: null }, l)).toEqual(["19.10: רענון ← ללא סטטוס"]);
    expect(describeChange({ table: "doch1_days", action: "update", before: row("g"), after: row("g") }, l)).toEqual([]);
    expect(describeChange({ table: "doch1_days", action: "insert", before: null, after: row("gone") }, l)).toEqual(["19.10: סטטוס שנמחק"]);
  });

  it("round fields: only the ones a person cares about", () => {
    const before = { in_report: true, call_up_on: null, location_id: null, sheet_row: 4, updated_at: "a" };
    const after = { in_report: false, call_up_on: "2026-09-06", location_id: "m131", sheet_row: 9, updated_at: "b" };
    expect(describeChange({ table: "doch1_members", action: "update", before, after }, l)).toEqual([
      "נספר בדוח: כן ← לא",
      "תאריך גיוס: — ← 06.09.2026",
      "מיקום בשבצ״ק: — ← מוצב 131",
    ]);
    expect(describeChange({ table: "doch1_members", action: "update", before, after: { ...before, sheet_row: 5 } }, l)).toEqual([]);
  });

  it("people: phone and platoon", () => {
    expect(
      describeChange({ table: "people", action: "update", before: { phone: null, unit_id: "p1" }, after: { phone: "0501234567", unit_id: "p2" } }, l),
    ).toEqual(["טלפון: — ← 0501234567", "מסגרת: מחלקה 1 ← מחלקה 2"]);
  });
});
