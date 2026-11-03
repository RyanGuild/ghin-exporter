# GHIN Scorecard Export

A simple **browser app** for exporting your own GHIN scorecards to **CSV**, **JSONL**, and **Excel (.xlsx)**.

Designed to be dad-friendly: open the page, enter GHIN email/number + password, pick formats, click Export.

**Live site:** https://ryanguild.github.io/ghin-exporter/

## Safety

- **Read-only** — signs in and downloads only. Never posts scores or edits profile.
- Credentials are entered in the form, kept in the browser tab, and sent **only to GHIN** (`api2.ghin.com`). This static site has no backend and does not store passwords.
- Polite request delay (configurable). Stops cleanly on 401 / 403 / 429.
- No public GHIN OAuth2 for personal apps; official partner access is USGA GPA/VASP. This uses the same consumer login the GHIN website uses.

## Use the website

1. Open the GitHub Pages URL.
2. Enter email or GHIN number + password.
3. Choose how many recent rounds, delay, and formats (CSV / JSONL / XLSX).
4. Click **Export scorecards** — files download to your computer.

## Local development

```bash
cd web
npm install
npm run dev
```

Production build (same as Pages):

```bash
cd web
npm run build
# output in web/dist — base path /ghin-exporter/
```

## Excel Automate → Run

Prefer pulling scorecards straight into Excel? Use **Automate → Run** with the Office Script in [`docs/power-automate-ghin.md`](docs/power-automate-ghin.md) (script + OneDrive `.osts` under `docs/power-automate/`).

## Optional Python CLI

A read-only Python CLI remains under `ghin_export/` / `export_ghin.py` if you prefer the terminal. See `.env.example`. The web UI is the primary interface.

## What gets exported

| Format | Contents |
|--------|----------|
| CSV | `scores`, `holes`, `profile` files |
| JSONL | one object per line for scores, holes, and meta |
| XLSX | workbook sheets: Scores, Holes, Profile, HandicapHistory |

Hole-level stats are often empty for manually posted total scores — that is normal GHIN behavior.
