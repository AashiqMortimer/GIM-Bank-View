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
  - Last updated (remote backend snapshot timestamp)
  - Hidden updated (remote hidden-items timestamp)
- Item visibility controls:
  - Hide/unhide buttons per item in each player table
  - **Show hidden items** toggle per player (off by default)
  - Hidden items are stored remotely, so they persist across devices/incognito sessions
- Compare table with filters:
  - Unique to Ad
  - Unique to Sic
  - In both
  - Differences only
  - Optional **Include hidden in compare** toggle
- Sync behavior:
  - **Sync now** (POST overwrite remote snapshot for that player)
  - **Pull latest** (GET remote snapshot + hidden IDs and overwrite local)
  - Polling auto-refresh every ~25 seconds
- Local persistence via `localStorage` for settings/UI state.

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
4. In Apps Script, open **Project Settings → Script properties** and set:
   - Key: `WRITE_SECRET`
   - Value: your shared write secret
5. Deploy web app:
   - **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** (for GitHub Pages GET/POST access)
6. Copy the web app URL.

### Sheet template

The script uses (and auto-creates if missing) these tabs:

#### `Snapshots`
1. `player`
2. `snapshotJson`
3. `lastUpdatedUtc`

#### `HiddenItems`
1. `player`
2. `hiddenJson` (JSON array of item IDs, e.g. `[563, 554, 28924]`)
3. `lastUpdatedUtc`

Rows are keyed by player name (`Ad The Saint` and `Sic Saint`) and always store only the latest values.

### Backend API behavior

- `GET` returns:
  - `serverTimeUtc`
  - `players[player].snapshot`
  - `players[player].lastUpdatedUtc`
  - `players[player].hidden`
  - `players[player].hiddenLastUpdatedUtc`
- `POST` supports actions:
  - `setSnapshot`: `{ secret, action: "setSnapshot", player, snapshot }`
  - `setHidden`: `{ secret, action: "setHidden", player, hidden: [itemId...] }`
- Corrupted JSON in sheet cells is safely handled:
  - invalid snapshot JSON falls back to an empty snapshot
  - invalid hidden JSON falls back to an empty hidden list

## App usage

1. Open your published GitHub Pages URL.
2. Go to **Settings** tab:
   - Paste Apps Script endpoint URL
   - Enter shared secret
   - Click **Save settings**
   - Click **Test connection**
3. For each player tab:
   - Import TSV by drag/drop file or paste TSV then click **Import pasted TSV**
   - Use **Hide/Unhide** on rows to set visibility for items
   - Click **Sync now** to write latest local snapshot to backend
   - Click **Pull latest** to overwrite local with remote state
4. Open **Compare** tab to view deltas and filter differences.

## Hide/unhide persistence notes

- Hidden item IDs are stored remotely in the `HiddenItems` sheet and synchronized on every refresh.
- Hide/unhide updates the UI immediately, then posts `setHidden` to the backend.
- Syncing a TSV snapshot (`setSnapshot`) does **not** change hidden IDs.
- By default, hidden items are excluded from compare for each player's side unless **Include hidden in compare** is enabled.

## Notes

- App still works for local viewing/comparison when offline.
- Sync controls require a reachable endpoint.
