import { dbErrorMessage, pgCode } from "@/lib/action-result";

/** Messages for the error codes raised by the ניהול פלוגה functions (0027_company_security.sql). */
const MESSAGES: Record<string, string> = {
  GD101: "יותר מדי ניסיונות היום. נסו שוב מחר, או פנו למפקד.",
  GD102: "בדקו את המספר האישי (5–12 ספרות) ואת 4 הספרות האחרונות של הטלפון.",
  GD103: "הבקשה כבר טופלה. רעננו את הדף.",
  GD104: "החייל כבר לא פעיל בדוח 1, ולכן אי אפשר לקשר אליו חשבון.",
  GD105: "החייל כבר מקושר לחשבון אחר. אם החליף חשבון, פנו למנהל המערכת.",
  GD106: "החשבון הושבת על ידי מנהל המערכת. פנו אליו.",
  GD107: "מספר טלפון לא תקין. כתבו מספר ישראלי, למשל 050-1234567.",
  GD108: "שם מלא: 2–60 תווים. תפקיד: עד 40 תווים.",
  GD109: "כתובת מייל לא תקינה.",
};

export function companyError(err: unknown): string {
  const code = pgCode(err);
  return (code && MESSAGES[code]) || dbErrorMessage(err);
}
