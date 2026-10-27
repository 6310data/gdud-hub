import { describe, expect, it } from "vitest";
import { guessName, nameMatchScore } from "./names";

const people = [
  { id: "1", fullName: "רועי כהן" },
  { id: "2", fullName: "שמעון מאיר" },
  { id: "3", fullName: "ויטלי פרידמן" },
  { id: "4", fullName: "דוד מוסאי" },
  { id: "5", fullName: "רון לוי" },
  { id: "6", fullName: "אביחי שושן" },
];

describe("nameMatchScore()", () => {
  it("scores the full name typed out (any order, any spacing) as 1", () => {
    expect(nameMatchScore("רועי כהן", "רועי כהן")).toBe(1);
    expect(nameMatchScore("כהן  רועי", "רועי כהן")).toBe(1);
  });

  it("forgives final letters and doubled ו / י", () => {
    expect(nameMatchScore("שמעון מאייר", "שמעון מאיר")).toBe(1);
    expect(nameMatchScore("כהנ", "רועי כהן")).toBeGreaterThan(0.9);
  });

  it("scores a first or last name alone a little below the full name", () => {
    const s = nameMatchScore("רועי", "רועי כהן");
    expect(s).toBeGreaterThan(0.9);
    expect(s).toBeLessThan(1);
  });

  it("scores unrelated names low, and more words than the full name 0", () => {
    expect(nameMatchScore("רועי", "רון לוי")).toBeLessThan(0.7);
    expect(nameMatchScore("רועי כהן בן דוד", "רועי כהן")).toBe(0);
  });
});

describe("guessName()", () => {
  it("guesses a first name, a last name and a misspelling", () => {
    expect(guessName("ויטלי", people)).toMatchObject({ kind: "guess", best: { id: "3" } });
    expect(guessName("מוסאי", people)).toMatchObject({ kind: "guess", best: { id: "4" } });
    expect(guessName("שמעון מאייר", people)).toMatchObject({ kind: "guess", best: { id: "2" } });
  });

  it("offers a short form but doesn't choose it", () => {
    expect(guessName("אבי", people)).toEqual({ kind: "unsure", ranked: [people[5]] });
  });

  it("is unsure when two soldiers fit as well", () => {
    const g = guessName("רועי", [...people, { id: "7", fullName: "רועי לוי" }]);
    expect(g.kind).toBe("unsure");
    if (g.kind === "unsure") expect(g.ranked.map((p) => p.id).sort()).toEqual(["1", "7"]);
  });

  it("finds nobody for a name that isn't there", () => {
    expect(guessName("משה", people)).toEqual({ kind: "none" });
    expect(guessName("", people)).toEqual({ kind: "none" });
  });
});
