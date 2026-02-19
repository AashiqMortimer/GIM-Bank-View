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
  return { snapshot: { items: [], meta: {} }, lastImportLocal: null, lastSyncedRemote: null, warnings: [] };
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      state.data.settings = parsed.settings || state.data.settings;
      PLAYERS.forEach((p) => {
        state.data.players[p] = { ...defaultPlayerState(), ...(parsed.players?.[p] || {}) };
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
  view.tbody = q("tbody");
  view.warnings = q(".warnings");
  view.summary = {
    unique: q(".sumUnique"), totalQty: q(".sumTotalQty"), imported: q(".sumImported"),
    synced: q(".sumSynced"), updated: q(".sumUpdated"), status: q(".sumStatus"),
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
  pdata.snapshot = { items: parsed.items, meta: { importedAtLocal: new Date().toISOString(), source: "tsv", appVersion: APP_VERSION } };
  pdata.lastImportLocal = new Date().toISOString();
  pdata.warnings = parsed.warnings;
  saveState();
  renderAll();
}

function getSortedItems(player) {
  const key = PLAYER_KEYS[player];
  const s = state.sort[key];
  const view = state.views[player];
  const term = view.searchInput.value.trim().toLowerCase();
  const unknownOnly = view.unknownOnly.checked;
  return [...state.data.players[player].snapshot.items]
    .filter((item) => !term || item.name.toLowerCase().includes(term) || String(item.id).includes(term))
    .filter((item) => !unknownOnly || !item.name || /^unknown$/i.test(item.name))
    .sort((a, b) => {
      const av = a[s.key]; const bv = b[s.key];
      if (typeof av === "string") return av.localeCompare(bv) * s.dir;
      return (av - bv) * s.dir;
    });
}

function renderPlayerTable(player) {
  const view = state.views[player];
  const items = getSortedItems(player);
  view.tbody.innerHTML = items.map((i) => `<tr><td>${escapeHtml(i.name || "")}</td><td>${i.id}</td><td>${i.qty}</td></tr>`).join("");
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (m) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[m])); }

function renderPlayerSummary(player) {
  const pdata = state.data.players[player];
  const remote = state.remote.players[player];
  const totalQty = pdata.snapshot.items.reduce((sum, i) => sum + i.qty, 0);
  const remoteNewer = remote?.lastUpdatedUtc && pdata.lastImportLocal && new Date(remote.lastUpdatedUtc) > new Date(pdata.lastImportLocal);
  const view = state.views[player];
  view.summary.unique.textContent = pdata.snapshot.items.length;
  view.summary.totalQty.textContent = totalQty;
  view.summary.imported.textContent = formatTs(pdata.lastImportLocal);
  view.summary.synced.textContent = formatTs(pdata.lastSyncedRemote);
  view.summary.updated.textContent = formatTs(remote?.lastUpdatedUtc);
  view.summary.status.textContent = remoteNewer ? "Remote is newer (consider Pull latest)" : "Ready";
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
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`POST failed: ${res.status}`);
  return res.json();
}

async function refreshRemote() {
  try {
    const data = await apiGet();
    state.remote = { ...state.remote, ...data, lastRefreshUtc: new Date().toISOString() };
    renderAll();
  } catch (err) {
    document.getElementById("globalStatus").textContent = `Offline or endpoint unreachable: ${err.message}`;
  }
}

async function syncNow(player) {
  const secret = state.data.settings.secret;
  if (!secret) { alert("Set shared secret first."); return; }
  const snapshot = state.data.players[player].snapshot;
  try {
    await apiPost({ secret, player, snapshot });
    state.data.players[player].lastSyncedRemote = new Date().toISOString();
    saveState();
    await refreshRemote();
  } catch (err) { alert(`Sync failed: ${err.message}`); }
}

function pullLatest(player) {
  const remote = state.remote.players[player];
  if (!remote?.snapshot) { alert("No remote snapshot found for this player."); return; }
  const local = state.data.players[player];
  const remoteNewer = remote.lastUpdatedUtc && local.lastImportLocal && new Date(remote.lastUpdatedUtc) > new Date(local.lastImportLocal);
  if (remoteNewer && local.snapshot.items.length && !confirm("Remote is newer and will overwrite local snapshot. Continue?")) return;
  local.snapshot = remote.snapshot;
  local.lastImportLocal = new Date().toISOString();
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

function renderCompare() {
  const ad = new Map(state.data.players[PLAYERS[0]].snapshot.items.map((i) => [String(i.id), i]));
  const sic = new Map(state.data.players[PLAYERS[1]].snapshot.items.map((i) => [String(i.id), i]));
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
  const adUpdated = state.remote.players?.[PLAYERS[0]]?.lastUpdatedUtc;
  const sicUpdated = state.remote.players?.[PLAYERS[1]]?.lastUpdatedUtc;
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
  ["filterUniqueAd", "filterUniqueSic", "filterInBoth", "filterDifferencesOnly", "compareSearch"].forEach((id) => {
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
  refreshRemote();
  setInterval(refreshRemote, POLL_MS);
}

init();
