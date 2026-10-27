# Reference code (not built, not deployed)

The old apps, kept here so behaviour can be compared while porting each module.

| Folder | Source |
|---|---|
| `logistics/` | לוגיסטיקה גדודית Apps Script (Code.gs, Index.html) |
| `platoon-web/` | platoon-web (ניהול פלוגה, Node on Vercel) |
| `Kesher/` | מחלקת קשר Apps Script (`Code.js.txt` = webapp_server, `Index.html` = webapp_ui, exported as RTF-HTML) and the module mockup `mockup/kesher.html` — serve the repo root (`python3 -m http.server`) and open `/references/Kesher/mockup/kesher.html`, so it picks up `tzelem.css` and the fonts. The sheet export (`*.xlsx`) holds real personal data and access codes: local only (git-ignored) |
| `doch1/` | דוח 1 mockup (`דוח 1 – אפליקציית מצבה.html`, unpacked screens in `mockup/NN.html`, list in `mockup/INDEX.txt`), design decisions, and `sheet-structure.md` — the layout of the round's Google Sheet that the importer reads. The sheet export itself (`*.xlsx`) holds real personal data: it stays on your machine only (git-ignored), never in the repository |

Don't copy secrets, access codes or real personal data into this folder.
