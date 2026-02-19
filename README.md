# OSRS Bank Sync Viewer (GitHub Pages + Google Sheets)

A static web app for comparing two RuneLite **Bank Memory plugin** TSV exports and syncing each player's latest bank snapshot through **Google Sheets + Apps Script**.

## Features

- Tabs for:
  - **Ad The Saint**
  - **Sic Saint**
  - **Compare**
  - **Settings**
- TSV import via drag/drop or pasted text.
- Robust TSV parsing:
  - Handles optional header row
  - Ignores empty lines / extra whitespace
  - Merges duplicate item IDs by summing quantities
  - Reports row warnings for invalid rows
- Per-player summary:
  - Unique items
  - Total quantity
  - Last imported (local)
  - Last synced (remote write from this app)
  - Last updated (remote backend timestamp)
- Compare table with filters:
  - Unique to Ad
  - Unique to Sic
  - In both
  - Differences only
- Sync behavior:
  - **Sync now** (POST overwrite remote for that player)
  - **Pull latest** (GET remote snapshot and overwrite local)
  - Polling auto-refresh every ~25 seconds
- Local offline persistence via `localStorage`.

## Repo layout

- `docs/index.html` – app markup (GitHub Pages root)
- `docs/styles.css` – app styles
- `docs/app.js` – app behavior, parsing, compare, sync, polling
- `apps-script/Code.gs` – Apps Script web app backend
- `samples/*.tsv` – sample RuneLite-style exports

## Enable GitHub Pages

1. Push this repo to GitHub.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, set source to **Deploy from a branch**.
4. Choose your branch (e.g., `main`) and folder **`/docs`**.
5. Save; GitHub will publish the app URL.

## Google Sheet + Apps Script setup

1. Create a Google Sheet (any name, e.g. `OSRS Bank Sync`).
2. Open **Extensions → Apps Script**.
3. Replace default code with `apps-script/Code.gs` from this repo.
4. Edit this constant in `Code.gs`:
   - `WRITE_SECRET = 'CHANGE_ME_SECRET'` → your real shared secret.
5. Deploy web app:
   - **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** (for GitHub Pages GET/POST access)
6. Copy the web app URL.

### Sheet template

The script uses (and auto-creates) a sheet named **Snapshots** with columns:

1. `player`
2. `snapshotJson`
3. `lastUpdatedUtc`

Rows are keyed by player name (`Ad The Saint` and `Sic Saint`) and always store only the latest snapshot.

## App usage

1. Open your published GitHub Pages URL.
2. Go to **Settings** tab:
   - Paste Apps Script endpoint URL
   - Enter shared secret
   - Click **Save settings**
   - Click **Test connection**
3. For each player tab:
   - Import TSV by drag/drop file or paste TSV then click **Import pasted TSV**
   - Click **Sync now** to write latest local snapshot to backend
   - Click **Pull latest** to overwrite local with remote state
4. Open **Compare** tab to view deltas and filter differences.

## Notes

- Settings + local snapshots are stored in browser `localStorage` only.
- App still works for local viewing/comparison when offline.
- Sync controls require a reachable endpoint.

