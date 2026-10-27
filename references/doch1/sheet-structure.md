# "דוח 1 - סבב שביעי" — sheet structure (for the importer)

Structure only — no personal data. Read from the .xlsx export (Google Sheets, 23 tabs, RTL, exported 2026-10-20).
Google-only functions (FILTER, FLATTEN, SORT, LET, IMPORTRANGE) come through as `__xludf.DUMMYFUNCTION(...)`;
their cached values are what the export holds. Load with `data_only=True` for values.

## Tabs to import

| Tab | Rows | What it is |
|---|---|---|
| מסייעת, פלנט, פלחהן, פלסר, אגם, פלסם | headers row 3, soldiers from row 4 | **Company day grids** — the source of truth for statuses |
| פלתצ (hidden) | headers row 3 | Older template, different column order (below). Soldiers not in גדודי |
| שבצק מסייעת / פלנט / פלחהן / פלסר / אגם | sections | Positions + standby per company |
| שבצק פלתצ (hidden) | sections | Older שבצ״ק layout |
| אלפון (hidden) | A1:L712 | Master roster (static values); W:AH is an IMPORTRANGE copy — ignore |
| Dropdowns (hidden) | A2:K40 | Configuration: companies, מסגרות, roles, status groups, round dates |
| שריון, גששים, צמה | small | Attached forces (no daily grid) |

Ignore: גדודי (derived from company tabs + שבצ״ק — useful only to cross-check), דוחות (formulas), סיכום יומי, מאסף, דוחות יום גיוס, סיכום גיוס (stale or derived).

## Company tabs

Row 1 hidden (A1 = company name). Row 3 = headers. One soldier per row, no section rows.

| Col | Header | Notes |
|---|---|---|
| A | פלוגה | |
| B | מסגרת | free text, no dropdown — spelling varies (see tolerances) |
| C | מספר אישי | join key everywhere |
| D | שם פרטי | |
| E | שם משפחה | |
| F | תפקיד בפועל | free text |
| G | תפקיד לדמ"ח | לוחם, קצין, מפקד זוטר, חובש, נהג, מט"ב, blank (= יתר) |
| H | טלפון | |
| I | סטטוס הגעה על פי צפי גיוס | cached IMPORTRANGE value (צפי הגעה) → a value of the round's צפי הגעה list (`doch1_field_options`, field `arrival`) |
| J | תאריך גיוס על פי צפי גיוס | פלנט header is just "תאריך גיוס" |
| K | סטטוס גיוס | התייצב, תאריך גיוס נדחה, תאריך נדחה ביום גיוס, שוחרר, שוחרר ביום גיוס, טרם התייצב, פוטנציאל נפקד, בדרך → a value of the round's סטטוס גיוס list (field `enlistment`); its meaning (התייצב / ממתין / נדחה / שוחרר) is set in the app |
| L | דיסקית | יש / אין |
| M…BS | one column per day | row-3 value is a datetime (`=תחילת_תאריך + n`); 23.08.2026 → export date |
| BT | "אבוי למי שנוגע" | hidden sentinel after the last day; day columns are inserted left of it |
| BU…CB | metrics | lookups from גדודי — recompute, don't import |
| CC | הערות | free text |

**Day-cell values** (all tabs): `0` (numeric, also `"0"`) = not on active duty that day (לא בשמ"פ); **empty = missing report**;
otherwise a status string: רענון, עזה, מיוערת, יוצא לרענון, שדה תימן, התארגנות, עורף, גימלים, קורס, יום התארגנות אחרון, רמ 2, נפקד,
and in פלתצ only: נחל עוז, עיבוד. No trailing-space variants.

Day-cell colors are Google dropdown chip colors — not in the xlsx. Status colors come from app settings.

## Status groups (Dropdowns G–K) — become status flags

Row-2 headers are written "סטטוס כללי", "סטטוס שנספר", "סטטוס רענון", "סטטוס התארגנות", "סטטוס שלא נספר" (G…K, in that order); values start in row 3.

- **שנספר** (counted as present): עזה, שדה תימן, מיוערת, עורף, קורס, גימלים, רמ 2, יוצא לרענון
- **כללי**: עיבוד + שנספר
- **רענון** (home days): רענון
- **התארגנות**: התארגנות, יום התארגנות אחרון
- **שלא נספר**: 0, נפקד

Named ranges: `תחילת_תאריך` = Dropdowns!L1 (round start 2026-08-23), `סוף_תאריך` = N1 (2026-12-10).

## Derived numbers the sheet computes (per soldier, from גדודי BY–CG)

- **Current רענון streak** (BY): days since the last non-רענון, non-empty day, if the latest days are רענון.
- **Presence days from call-up** (BZ): count of שנספר statuses from column AA (06.09, call-up day) on.
- **Home days from call-up** (CA): count of רענון statuses from 06.09.
- **Total ימ"מ** (CB): count of כללי + רענון from round start (התארגנות excluded).
- **התארגנות entitlement** (CC): CB <10 → 0, ≤14 → 2, ≤28 → 3, ≤42 → 5, ≤56 → 7, ≥57 → 9.
- **התארגנות entered** (CD): count of התארגנות-group days.
- **Remaining** (CE): CC − (CD − adj), adj = 0 / 0.5 / 1 when 0 / 1 / ≥2 התארגנות days fall on Fri/Sat.
- **Home %** (CF): CA / (CA + BZ); red above 55%.
- **עורף days** (CG): count of עורף from 06.09.

## שבצ״ק tabs ("שבצק <company>")

Columns A–M: מס"ד, פלוגה, מסגרת, סטטוס דוח 1 (formula — today's status), מיקום, צ כלי, כוננות, מספר אישי, שם פרטי, שם משפחה,
תפקיד בפועל, פעילות, הערות. (פלסר has "תקן" in K; אגם misspells "סטאטוס דוח 1".)

- **Layout:** sections = a merged A:M title row (e.g. חפ"ק מ"פ, מפל"ג, צוות 1…5, כח עיט, כוחות חבירים, פלס"ם) → a **repeated header row** (H = "מספר אישי") → soldier rows. Skip title and header rows.
- **מיקום** (E): בחוץ, מוצב 123, מוצב 131.
- **כוננות** (G), per company: מסייעת — פינוי א, פינוי ב, חפ"ק, חר"ק מיוערת, חר"ק 123, עתודה, כוננות 7; פלנט/פלחהן — כרמל, חפ"ק; פלסר — עתודת גדוד, חפ"ק; אגם — חפ"ק מג"ד 1/2, חפ"ק סמג"ד 1/2; all — לא בכוננות.
- **צ כלי** (F): looked up from the side table "שיבוץ כלים" (O9:P23: כוננות → vehicle number). Vehicle types in "כלים": האמר, דימאקס.
- **כוחות חבירים / פלס"ם sections** hold soldiers whose column B is another company. גדודי resolves פלסם and תאגד soldiers across all שבצ״ק tabs (first non-empty wins).
- Not found in any שבצ״ק → "לא נמצא בשבצק".

## פלתצ (old template)

C מספר אישי, D שם משפחה, E שם פרטי, F טלפון, G תפקיד בפועל, H–K recruitment fields, no תפקיד לדמ"ח.
Day columns L…KJ (285 pre-allocated days through 06.05.2027 — future columns exist), sentinel KK.
Its שבצ״ק uses מיקום values בחוץ / משימה / מגנן 76 / מגנן 88 / מטאור 3 and extra columns משימה/נסיעה, צ רכב.
The company is inactive this round; one of its soldiers also appears in פלסר.

## אלפון (roster) — also the layout of the per-round people file (the battalion's list, `/doch1/planning/roster`)

שם מלא, מספר אישי, שם פרטי, שם משפחה, פלוגה, מחלקה, מקצוע, לכמה סבבים הגיע, מספר טלפון, גיל, האם קצין (כן/לא), תפקיד בפועל.

## Configuration lists (Dropdowns, row 2 = column names)

- **פלוגות:** אגם, פלסם, פלנט, פלחהן, פלסר, פלתצ, מסייעת, בלתי מתאים, בלתי משובץ, בלתי נקרא
- **מחלקות/מסגרות:** חפ"ק מג"ד מצומצם, חפ"ק סמג"ד מצומצם, מבצעים, מודיעין, מפג"ד, עודפי כ"א, תאג"ד, חפ"ק מ"פ, כיתת פינוי כבדה, מחלקת מרגמות, מפל"ג, פת"ן, חפ"ק סמ"פ, צוות 1–5, צוותי פלחה"ן, טנ"א, לוגיסטיקה, מטבח, קשר, רבנות, רכב, שלישות, כוח עיט, מח' תצפית, לא הוזן, …
- **מקצועות** (34): מג"ד, מ"מ, לוחם, סמג"ד, חובש, רופא, פראמדיק, נהג, מ"פ, סמ"פ, סרס"פ, מ"כ, צלף, קשר, סמל, קצין, …

## Attached forces

- **שריון** ("שריון 9מ"): grouped by tank ("צ 281", …, "לא משובצקים"), header row + formula-only placeholder rows per group. Has rank (דרגה), סוג שירות (סדיר/קבע), צוות, מיקום (המיוערת / מוצב 123 / מוצב 131 / שדה תימן / צאלים / שזפון), and a computed דמ"ח category in L. No daily grid.
- **גששים / צמה:** תפקיד + a single "דיווח" value (מיוערת/רענון) + פעילות; counts are `countif(F:F,"מיוערת")`. No daily grid. צמה H6:I11 holds a contact panel (personal data — don't import).

## Reports in דוחות (how the sheet counts — the app must match for the pilot)

All counts use today's column of גדודי.

- **Section A — critical roles by מסגרת × מיקום:** rows are company × location. **מיוערת rows count by today's status = מיוערת; outpost rows count by שבצ״ק location only (today's status is not checked).** Columns: קצין, מפקד זוטר, לוחם, מט"ב, חובש, נהג, גששים, תצפתניות, יתר (G blank). M סדיר (attached only), N מילואים, O total, P across border = 0 for מיוערת else O.
- **Section B — data control per company:** rows in company tab vs גדודי; not on duty (`0` + נפקד); missing (empty); on duty = rows − not on duty − missing; עזה without outpost = סה"כ עזה − (131 + 123); at an outpost but today ≠ עזה.
- **Section C — 15א:** per company עזה split מוצב 131 / מוצב 123, סה"כ עזה, מיוערת, סה"כ; attached forces from their tabs. "סה"כ שמ"פ גדוד" = total + 1 (קב"ן).
- **Section D — 10א מחנה מיוערת:** חפ"קים + תאג"ד, מכלול (מבצעים + מודיעין), פלס"ם, מסייעת, שריון, צמה, גששים; a free-text "מפקד" per row.
- **Section E — מט"בים:** hand-typed list of doctors/paramedics with today's status and שבצ״ק location.
- **Section F — סד"כ per מסגרת:** per company, a row per מסגרת: עזה split by שבצ״ק location, then one column per status, then חסר דיווח, total. `0` and "יום התארגנות אחרון" are counted in no column. מסגרת must equal גדודי column B exactly.
- **דוחות יום גיוס:** per company count of סטטוס גיוס values; התייצב %; a WhatsApp block for the brigade. The app's יום גיוס screen (`/doch1/call-up`) replaces it.

## What the importer must tolerate

1. `0` / `0.0` / `"0"` = לא בשמ"פ; empty = missing. Both are real.
2. מספר אישי: 7 digits, mixed types (strings and floats like `8123456.0`), some with surrounding whitespace → normalize to a digit string.
3. מסגרת spelling varies: מפלג / מפל"ג, תאגד / תאג"ד, מפג״ד (U+05F4) / מפג"ד, "…מצומצם", בלתי מתאימים / בלתי מתאים, כוח עיט / כח עיט, מחלקת מרגמות / מרגמות, חפ"ק סמ"פ / חולית סמ"פ, plus values not in the list (עורק, צלפים). Normalize `״`→`"`, `׳`→`'`, trim, and match on a canonical key; unknown → ask in the preview.
4. Header text varies (`תאריך גיוס` vs `…על פי צפי גיוס`, `תקן` vs `תפקיד בפועל`, `סטאטוס`, embedded `\n`) → map by fuzzy header match, not position.
5. Dates: read from the row-3 header values, not by column offset. Dates after the export date are plan data (פלתצ has them).
6. Cell errors / leftovers: `#N/A`, `#REF!`, `-`, `" "`, trailing spaces ("צ 273 ") → treat as empty.
7. Hidden rows (a filter view on גדודי hides 619 rows) and hidden columns → ignore hiding.
8. A soldier can appear in two company tabs (פלתצ + פלסר) and in another company's שבצ״ק section → report, don't duplicate.
