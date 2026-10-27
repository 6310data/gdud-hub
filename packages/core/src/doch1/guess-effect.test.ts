import { describe, expect, it } from "vitest";
import { guessEnlistmentEffect } from "./counting";

describe("guessEnlistmentEffect", () => {
  it("reads the sheet's words", () => {
    expect(guessEnlistmentEffect("התייצב")).toBe("arrived");
    expect(guessEnlistmentEffect("התייצב חלקית")).toBe("arrived");
    expect(guessEnlistmentEffect("טרם התייצב")).toBe("pending");
    expect(guessEnlistmentEffect("לא התייצב")).toBe("pending");
    expect(guessEnlistmentEffect("פוטנציאל נפקד")).toBe("pending");
    expect(guessEnlistmentEffect("בדרך")).toBe("pending");
    expect(guessEnlistmentEffect("תאריך גיוס נדחה")).toBe("postponed");
    expect(guessEnlistmentEffect("שוחרר")).toBe("released");
    expect(guessEnlistmentEffect("משהו אחר")).toBe("pending");
  });
});
