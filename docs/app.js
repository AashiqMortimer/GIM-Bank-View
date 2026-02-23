const PLAYERS = ["Ad The Saint", "Sic Saint"];
const PLAYER_KEYS = { "Ad The Saint": "ad", "Sic Saint": "sic" };
const STORAGE_KEY = "osrsBankSyncViewer.v1";
const APP_VERSION = "1.0.0";
const POLL_MS = 25000;

const state = {
  data: {
    settings: { endpointUrl: "", secret: "" },
    players: {},
  },
  remote: { players: {}, serverTimeUtc: null, lastRefreshUtc: null },
  sort: { ad: { key: "name", dir: 1 }, sic: { key: "name", dir: 1 }, compare: { key: "name", dir: 1 } },
  views: {},
};

function defaultPlayerState() {
  return {
    snapshot: { items: [], meta: {} },
    hiddenIds: [],
    timestamps: {
      remoteSnapshotLastUpdatedUtc: null,
      remoteHiddenLastUpdatedUtc: null,
      localImportedAt: null,
      lastRefresh: null,
    },
    lastSyncedRemote: null,
    warnings: [],
    showHiddenItems: false,
  };
}

function normalizePlayerState(raw) {
  const base = defaultPlayerState();
  const normalized = { ...base, ...(raw || {}) };
  const oldImportedAt = normalized.lastImportLocal || normalized.timestamps?.localImportedAt || null;
  normalized.timestamps = { ...base.timestamps, ...(normalized.timestamps || {}), localImportedAt: oldImportedAt };
  normalized.hiddenIds = Array.isArray(normalized.hiddenIds) ? normalized.hiddenIds.map(Number).filter(Number.isFinite) : [];
  normalized.snapshot = {
    items: Array.isArray(normalized.snapshot?.items) ? normalized.snapshot.items : [],
    meta: normalized.snapshot?.meta || {},
  };
  delete normalized.lastImportLocal;
  return normalized;
}

function hasLocalSnapshot(player) {
  const pdata = state.data.players[player];
  return Boolean(pdata.timestamps.localImportedAt && pdata.snapshot.items.length > 0);
}

function canSyncPlayer(player) {
  const pdata = state.data.players[player];
  return hasLocalSnapshot(player) && pdata.snapshot.meta?.source === "tsv";
}

function getFreshnessIndicator(player) {
  const local = state.data.players[player];
  const remoteUpdatedUtc = local.timestamps.remoteSnapshotLastUpdatedUtc;
  if (!local.timestamps.localImportedAt || !remoteUpdatedUtc) return "In sync";
  const localTs = new Date(local.timestamps.localImportedAt).getTime();
  const remoteTs = new Date(remoteUpdatedUtc).getTime();
  if (Number.isNaN(localTs) || Number.isNaN(remoteTs) || localTs === remoteTs) return "In sync";
  return remoteTs > localTs ? "Remote newer" : "Local newer";
}

function isRemoteNewerThanLocal(player) {
  return getFreshnessIndicator(player) === "Remote newer";
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      state.data.settings = parsed.settings || state.data.settings;
      PLAYERS.forEach((p) => {
        state.data.players[p] = normalizePlayerState(parsed.players?.[p]);
      });
      return;
    } catch (_) {}
  }
  PLAYERS.forEach((p) => { state.data.players[p] = defaultPlayerState(); });
}

function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data)); }
function formatTs(iso) { return iso ? new Date(iso).toLocaleString() : "—"; }

function parseTSV(tsvText) {
  const warnings = [];
  const rows = tsvText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const merged = new Map();
  rows.forEach((line, idx) => {
    const cols = line.split("\t");
    if (cols.length < 3) {
      warnings.push(`Row ${idx + 1}: expected 3 columns.`);
      return;
    }
    const [rawId, ...rest] = cols;
    const rawQty = rest.pop();
    const rawName = rest.join("\t");
    if (/^item\s*id$/i.test(rawId.trim()) && /^item\s*quantity$/i.test(String(rawQty).trim())) return;
    const id = Number.parseInt(rawId.trim(), 10);
    const qty = Number.parseInt(String(rawQty).trim(), 10);
    if (Number.isNaN(id) || Number.isNaN(qty)) {
      warnings.push(`Row ${idx + 1}: invalid id or quantity.`);
      return;
    }
    const name = rawName.trim();
    const key = String(id);
    const curr = merged.get(key) || { id, name, qty: 0 };
    curr.qty += qty;
    if (!curr.name && name) curr.name = name;
    merged.set(key, curr);
  });
  return { items: [...merged.values()], warnings };
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    });
  });
}

function renderPlayerShell(player) {
  const key = PLAYER_KEYS[player];
  const target = document.getElementById(`tab-${key}`);
  const t = document.getElementById("playerTemplate").content.cloneNode(true);
  t.querySelector(".player-title").textContent = player;
  target.appendChild(t);

  const view = state.views[player] = { container: target };
  const q = (sel) => target.querySelector(sel);
  view.dropZone = q(".drop-zone");
  view.fileInput = q(".file-input");
  view.pasteArea = q(".paste-area");
  view.importPasteBtn = q(".importPasteBtn");
  view.syncNowBtn = q(".syncNowBtn");
  view.pullLatestBtn = q(".pullLatestBtn");
  view.resetLocalBtn = q(".resetLocalBtn");
  view.searchInput = q(".searchInput");
  view.unknownOnly = q(".unknownOnly");
  view.showHiddenItems = q(".showHiddenItems");
  view.tbody = q("tbody");
  view.warnings = q(".warnings");
  view.summary = {
    unique: q(".sumUnique"), totalQty: q(".sumTotalQty"), imported: q(".sumImported"),
    synced: q(".sumSynced"), updated: q(".sumUpdated"), refresh: q(".sumRefresh"), status: q(".sumStatus"),
    hiddenUpdated: q(".sumHiddenUpdated"),
  };

  view.dropZone.addEventListener("click", () => view.fileInput.click());
  view.fileInput.addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    importTSV(player, await file.text());
  });
  ["dragover", "dragenter"].forEach((evt) => view.dropZone.addEventListener(evt, (e) => {
    e.preventDefault(); view.dropZone.classList.add("dragover");
  }));
  ["dragleave", "drop"].forEach((evt) => view.dropZone.addEventListener(evt, (e) => {
    e.preventDefault(); view.dropZone.classList.remove("dragover");
  }));
  view.dropZone.addEventListener("drop", async (ev) => {
    const file = ev.dataTransfer?.files?.[0];
    if (!file) return;
    importTSV(player, await file.text());
  });
  view.importPasteBtn.addEventListener("click", () => importTSV(player, view.pasteArea.value));
  view.syncNowBtn.addEventListener("click", () => syncNow(player));
  view.pullLatestBtn.addEventListener("click", () => pullLatest(player));
  view.resetLocalBtn.addEventListener("click", () => resetLocal(player));
  view.searchInput.addEventListener("input", () => renderPlayerTable(player));
  view.unknownOnly.addEventListener("change", () => renderPlayerTable(player));
  view.showHiddenItems.addEventListener("change", () => {
    state.data.players[player].showHiddenItems = view.showHiddenItems.checked;
    saveState();
    renderPlayerTable(player);
  });
  q("thead").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-sort]");
    if (!th) return;
    toggleSort(key, th.dataset.sort);
    renderPlayerTable(player);
  });
}

function toggleSort(viewKey, key) {
  const s = state.sort[viewKey];
  if (s.key === key) s.dir *= -1;
  else { s.key = key; s.dir = 1; }
}

function importTSV(player, text) {
  const parsed = parseTSV(text || "");
  const pdata = state.data.players[player];
  const now = new Date().toISOString();
  pdata.snapshot = { items: parsed.items, meta: { importedAtLocal: now, source: "tsv", appVersion: APP_VERSION } };
  pdata.timestamps.localImportedAt = now;
  pdata.warnings = parsed.warnings;
  saveState();
  renderAll();
}

function getHiddenSet(player) {
  return new Set(state.data.players[player].hiddenIds.map((id) => String(id)));
}

function getSortedItems(player) {
  const key = PLAYER_KEYS[player];
  const s = state.sort[key];
  const view = state.views[player];
  const term = view.searchInput.value.trim().toLowerCase();
  const unknownOnly = view.unknownOnly.checked;
  const showHidden = view.showHiddenItems.checked;
  const hidden = getHiddenSet(player);
  return [...state.data.players[player].snapshot.items]
    .filter((item) => !term || item.name.toLowerCase().includes(term) || String(item.id).includes(term))
    .filter((item) => !unknownOnly || !item.name || /^unknown$/i.test(item.name))
    .filter((item) => showHidden || !hidden.has(String(item.id)))
    .sort((a, b) => {
      const av = a[s.key]; const bv = b[s.key];
      if (typeof av === "string") return av.localeCompare(bv) * s.dir;
      return (av - bv) * s.dir;
    });
}

function renderPlayerTable(player) {
  const view = state.views[player];
  const items = getSortedItems(player);
  const hidden = getHiddenSet(player);
  view.tbody.innerHTML = items.map((i) => {
    const isHidden = hidden.has(String(i.id));
    return `<tr>
      <td>${escapeHtml(i.name || "")}</td>
      <td>${i.id}</td>
      <td>${i.qty}</td>
      <td><button type="button" class="hide-toggle-btn" data-item-id="${i.id}">${isHidden ? "Unhide" : "Hide"}</button></td>
    </tr>`;
  }).join("");

  view.tbody.querySelectorAll(".hide-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => toggleHidden(player, Number(btn.dataset.itemId)));
  });
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (m) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[m])); }

function renderPlayerSummary(player) {
  const pdata = state.data.players[player];
  const totalQty = pdata.snapshot.items.reduce((sum, i) => sum + i.qty, 0);
  const view = state.views[player];
  const indicator = getFreshnessIndicator(player);
  const syncAllowed = canSyncPlayer(player);
  view.summary.unique.textContent = pdata.snapshot.items.length;
  view.summary.totalQty.textContent = totalQty;
  view.summary.imported.textContent = formatTs(pdata.timestamps.localImportedAt);
  view.summary.synced.textContent = formatTs(pdata.lastSyncedRemote);
  view.summary.updated.textContent = formatTs(pdata.timestamps.remoteSnapshotLastUpdatedUtc);
  view.summary.hiddenUpdated.textContent = formatTs(pdata.timestamps.remoteHiddenLastUpdatedUtc);
  view.summary.refresh.textContent = formatTs(pdata.timestamps.lastRefresh);
  view.summary.status.textContent = indicator;
  view.showHiddenItems.checked = Boolean(pdata.showHiddenItems);
  view.syncNowBtn.disabled = !syncAllowed;
  view.syncNowBtn.title = syncAllowed ? "" : "Import TSV with at least one item before syncing.";
  view.warnings.innerHTML = pdata.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("");
}

async function apiGet() {
  const url = state.data.settings.endpointUrl;
  if (!url) throw new Error("Endpoint URL missing.");
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  return res.json();
}

async function apiPost(payload) {
  const res = await fetch(state.data.settings.endpointUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`POST failed: ${res.status}`);
  return res.json();
}

function hydrateLocalFromRemote({ force = false, onlyIfEmpty = false } = {}) {
  let changed = false;
  PLAYERS.forEach((player) => {
    const remote = state.remote.players?.[player];
    const local = state.data.players[player];
    if (!remote) return;

    local.hiddenIds = Array.isArray(remote.hidden) ? remote.hidden.map(Number).filter(Number.isFinite) : [];
    local.timestamps.remoteHiddenLastUpdatedUtc = remote.hiddenLastUpdatedUtc || null;

    if (!remote.snapshot) return;
    const localEmpty = !local.snapshot.items.length;
    if (!force && onlyIfEmpty && !localEmpty) return;
    if (!force && !onlyIfEmpty) return;
    local.snapshot = remote.snapshot;
    local.timestamps.localImportedAt = remote.lastUpdatedUtc || new Date().toISOString();
    local.warnings = [];
    changed = true;
  });
  if (changed) saveState();
}

function applyRemoteToLocalTimestamps() {
  PLAYERS.forEach((player) => {
    const remote = state.remote.players?.[player] || {};
    const local = state.data.players[player];
    local.timestamps.remoteSnapshotLastUpdatedUtc = remote.lastUpdatedUtc || null;
    local.timestamps.remoteHiddenLastUpdatedUtc = remote.hiddenLastUpdatedUtc || null;
    local.timestamps.lastRefresh = state.remote.lastRefreshUtc;
    if (Array.isArray(remote.hidden)) {
      local.hiddenIds = remote.hidden.map(Number).filter(Number.isFinite);
    }
  });
}

async function refreshRemote({ hydrateLocal = false, onlyIfEmpty = false } = {}) {
  try {
    const data = await apiGet();
    state.remote = { ...state.remote, ...data, lastRefreshUtc: new Date().toISOString() };
    applyRemoteToLocalTimestamps();
    if (hydrateLocal) hydrateLocalFromRemote({ force: !onlyIfEmpty, onlyIfEmpty });
    saveState();
    renderAll();
    return true;
  } catch (err) {
    document.getElementById("globalStatus").textContent = `Offline or endpoint unreachable: ${err.message}`;
    return false;
  }
}

async function syncNow(player) {
  const secret = state.data.settings.secret;
  if (!secret) { alert("Set shared secret first."); return; }
  if (!canSyncPlayer(player)) { alert("Import TSV with at least one item before syncing."); return; }
  if (isRemoteNewerThanLocal(player) && !confirm("Remote snapshot is newer than your local import. Syncing now will overwrite remote data. Continue?")) return;
  const snapshot = state.data.players[player].snapshot;
  try {
    await apiPost({ secret, action: "setSnapshot", player, snapshot });
    state.data.players[player].lastSyncedRemote = new Date().toISOString();
    saveState();
    await refreshRemote();
  } catch (err) { alert(`Sync failed: ${err.message}`); }
}

async function persistHidden(player) {
  const secret = state.data.settings.secret;
  if (!secret || !state.data.settings.endpointUrl) return;
  const hidden = state.data.players[player].hiddenIds;
  try {
    await apiPost({ secret, action: "setHidden", player, hidden });
    await refreshRemote();
  } catch (err) {
    alert(`Failed to persist hidden items: ${err.message}`);
  }
}

function toggleHidden(player, itemId) {
  const pdata = state.data.players[player];
  const ids = new Set(pdata.hiddenIds.map((id) => String(id)));
  const key = String(itemId);
  if (ids.has(key)) ids.delete(key);
  else ids.add(key);
  pdata.hiddenIds = [...ids].map(Number).filter(Number.isFinite);
  saveState();
  renderAll();
  persistHidden(player);
}

async function pullLatest(player) {
  await refreshRemote();
  const remote = state.remote.players[player];
  if (!remote?.snapshot) { alert("No remote snapshot found for this player."); return; }
  const local = state.data.players[player];
  const remoteNewer = remote.lastUpdatedUtc && local.timestamps.localImportedAt && new Date(remote.lastUpdatedUtc) > new Date(local.timestamps.localImportedAt);
  if (remoteNewer && local.snapshot.items.length && !confirm("Remote is newer and will overwrite local snapshot. Continue?")) return;
  local.snapshot = remote.snapshot;
  local.timestamps.localImportedAt = remote.lastUpdatedUtc || new Date().toISOString();
  local.snapshot.meta = { ...(local.snapshot.meta || {}), source: "remote" };
  local.hiddenIds = Array.isArray(remote.hidden) ? remote.hidden.map(Number).filter(Number.isFinite) : [];
  local.warnings = [];
  saveState();
  renderAll();
}

function resetLocal(player) {
  if (!confirm(`Reset local data for ${player}?`)) return;
  state.data.players[player] = defaultPlayerState();
  saveState();
  renderAll();
}

function buildCompareItems(player, includeHidden) {
  const hidden = getHiddenSet(player);
  return state.data.players[player].snapshot.items.filter((item) => includeHidden || !hidden.has(String(item.id)));
}

function renderCompare() {
  const includeHidden = document.getElementById("includeHiddenCompare").checked;
  const ad = new Map(buildCompareItems(PLAYERS[0], includeHidden).map((i) => [String(i.id), i]));
  const sic = new Map(buildCompareItems(PLAYERS[1], includeHidden).map((i) => [String(i.id), i]));
  const ids = new Set([...ad.keys(), ...sic.keys()]);
  const rows = [...ids].map((id) => {
    const a = ad.get(id); const s = sic.get(id);
    return {
      id: Number(id),
      name: a?.name || s?.name || "",
      adQty: a?.qty || 0,
      sicQty: s?.qty || 0,
      delta: (a?.qty || 0) - (s?.qty || 0),
    };
  });

  const opts = {
    uniqueAd: document.getElementById("filterUniqueAd").checked,
    uniqueSic: document.getElementById("filterUniqueSic").checked,
    inBoth: document.getElementById("filterInBoth").checked,
    diffOnly: document.getElementById("filterDifferencesOnly").checked,
    term: document.getElementById("compareSearch").value.trim().toLowerCase(),
  };

  const filtered = rows.filter((r) => {
    if (opts.term && !r.name.toLowerCase().includes(opts.term) && !String(r.id).includes(opts.term)) return false;
    const categoryMatches = [];
    if (opts.uniqueAd) categoryMatches.push(r.adQty > 0 && r.sicQty === 0);
    if (opts.uniqueSic) categoryMatches.push(r.sicQty > 0 && r.adQty === 0);
    if (opts.inBoth) categoryMatches.push(r.sicQty > 0 && r.adQty > 0);
    if (categoryMatches.length > 0 && !categoryMatches.some(Boolean)) return false;
    if (opts.diffOnly && r.adQty === r.sicQty) return false;
    return true;
  });

  const s = state.sort.compare;
  filtered.sort((a, b) => {
    const av = a[s.key]; const bv = b[s.key];
    if (typeof av === "string") return av.localeCompare(bv) * s.dir;
    return (av - bv) * s.dir;
  });

  const tbody = document.querySelector("#compareTable tbody");
  tbody.innerHTML = filtered.map((r) => `<tr><td>${escapeHtml(r.name)}</td><td>${r.id}</td><td>${r.adQty}</td><td>${r.sicQty}</td><td>${r.delta}</td></tr>`).join("");

  const summary = document.getElementById("compareSummary");
  summary.innerHTML = `
    <div><strong>Total rows:</strong> ${filtered.length}</div>
    <div><strong>Unique to Ad:</strong> ${rows.filter((r) => r.adQty > 0 && r.sicQty === 0).length}</div>
    <div><strong>Unique to Sic:</strong> ${rows.filter((r) => r.sicQty > 0 && r.adQty === 0).length}</div>
    <div><strong>In both:</strong> ${rows.filter((r) => r.sicQty > 0 && r.adQty > 0).length}</div>
    <div><strong>Differences:</strong> ${rows.filter((r) => r.adQty !== r.sicQty).length}</div>
  `;
}

function renderGlobalStatus() {
  const adUpdated = state.data.players?.[PLAYERS[0]]?.timestamps?.remoteSnapshotLastUpdatedUtc;
  const sicUpdated = state.data.players?.[PLAYERS[1]]?.timestamps?.remoteSnapshotLastUpdatedUtc;
  const status = `Remote updated: Ad ${formatTs(adUpdated)} | Sic ${formatTs(sicUpdated)} | Last refresh: ${formatTs(state.remote.lastRefreshUtc)}`;
  document.getElementById("globalStatus").textContent = status;
}

function renderAll() {
  PLAYERS.forEach((player) => { renderPlayerSummary(player); renderPlayerTable(player); });
  renderCompare();
  renderGlobalStatus();
}

function initSettings() {
  const endpoint = document.getElementById("endpointUrl");
  const secret = document.getElementById("sharedSecret");
  const status = document.getElementById("settingsStatus");
  endpoint.value = state.data.settings.endpointUrl || "";
  secret.value = state.data.settings.secret || "";

  document.getElementById("saveSettingsBtn").addEventListener("click", () => {
    state.data.settings.endpointUrl = endpoint.value.trim();
    state.data.settings.secret = secret.value;
    saveState();
    status.textContent = "Settings saved.";
    if (state.data.settings.endpointUrl) refreshRemote({ hydrateLocal: true, onlyIfEmpty: true });
  });
  document.getElementById("testConnectionBtn").addEventListener("click", async () => {
    state.data.settings.endpointUrl = endpoint.value.trim();
    state.data.settings.secret = secret.value;
    saveState();
    try {
      const data = await apiGet();
      status.textContent = `Connected. serverTimeUtc = ${data.serverTimeUtc || "(missing)"}`;
      await refreshRemote();
    } catch (err) {
      status.textContent = `Connection failed: ${err.message}`;
    }
  });
}

function initCompareEvents() {
  ["filterUniqueAd", "filterUniqueSic", "filterInBoth", "filterDifferencesOnly", "compareSearch", "includeHiddenCompare"].forEach((id) => {
    document.getElementById(id).addEventListener("input", renderCompare);
    document.getElementById(id).addEventListener("change", renderCompare);
  });
  document.querySelector("#compareTable thead").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-compare-sort]");
    if (!th) return;
    toggleSort("compare", th.dataset.compareSort);
    renderCompare();
  });
}

function init() {
  loadState();
  setupTabs();
  PLAYERS.forEach(renderPlayerShell);
  initCompareEvents();
  initSettings();
  renderAll();
  if (state.data.settings.endpointUrl) {
    refreshRemote({ hydrateLocal: true, onlyIfEmpty: true });
  }
  setInterval(() => refreshRemote(), POLL_MS);
}

init();
