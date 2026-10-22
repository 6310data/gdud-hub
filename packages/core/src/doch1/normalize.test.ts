import { expect, it } from "vitest";
import { canonicalName, cellText, normalizePersonalNumber } from "./normalize";

it("canonicalName folds gershayim and quotes", () => {
  expect(canonicalName(" מפל״ג ")).toBe(canonicalName('מפל"ג'));
  expect(canonicalName("מפלג")).toBe(canonicalName('מפל"ג'));
  expect(canonicalName("חפ\"ק  סמ׳פ\n")).toBe("חפק סמפ");
});

it("normalizePersonalNumber", () => {
  expect(normalizePersonalNumber(8123456)).toBe("8123456");
  expect(normalizePersonalNumber(" 8123456.0 ")).toBe("8123456");
  expect(normalizePersonalNumber("#N/A")).toBeNull();
  expect(normalizePersonalNumber("")).toBeNull();
  expect(normalizePersonalNumber(12.5)).toBeNull();
  expect(normalizePersonalNumber("1234")).toBeNull();
});

it("cellText treats sheet errors as empty", () => expect(["#N/A", "#REF!", "-", " ", null].map(cellText)).toEqual(["", "", "", "", ""]));
it("cellText keeps numeric 0 and trims text", () => expect([0, " עזה ", undefined].map(cellText)).toEqual(["0", "עזה", ""]));
