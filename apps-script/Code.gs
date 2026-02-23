/**
 * OSRS Bank Sync backend for Google Apps Script Web App.
 *
 * Sheet format (sheet name: Snapshots):
 * A: player
 * B: snapshotJson
 * C: lastUpdatedUtc
 *
 * Sheet format (sheet name: HiddenItems):
 * A: player
 * B: hiddenJson
 * C: lastUpdatedUtc
 */

const SNAPSHOTS_SHEET_NAME = 'Snapshots';
const HIDDEN_ITEMS_SHEET_NAME = 'HiddenItems';
const PLAYERS = ['Ad The Saint', 'Sic Saint'];

function getWriteSecret_() {
  return PropertiesService.getScriptProperties().getProperty('WRITE_SECRET');
}

function doGet() {
  try {
    const snapshots = readSheetByPlayer_(SNAPSHOTS_SHEET_NAME, (value) => {
      const parsed = safeParseJson_(value, {});
      return {
        items: Array.isArray(parsed.items) ? parsed.items : [],
        meta: parsed && typeof parsed.meta === 'object' ? parsed.meta : {},
      };
    });

    const hidden = readSheetByPlayer_(HIDDEN_ITEMS_SHEET_NAME, (value) => {
      const parsed = safeParseJson_(value, []);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id));
    });

    const players = {};
    PLAYERS.forEach((player) => {
      const snapRow = snapshots[player] || {};
      const hiddenRow = hidden[player] || {};
      players[player] = {
        snapshot: snapRow.value || { items: [], meta: {} },
        lastUpdatedUtc: snapRow.lastUpdatedUtc || null,
        hidden: hiddenRow.value || [],
        hiddenLastUpdatedUtc: hiddenRow.lastUpdatedUtc || null,
      };
    });

    return jsonOutput_({
      serverTimeUtc: new Date().toISOString(),
      players,
    });
  } catch (error) {
    return jsonOutput_({ ok: false, error: String(error) });
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOutput_({ ok: false, error: 'Missing body' });
    }
    const body = JSON.parse(e.postData.contents);

    const secret = getWriteSecret_();
    if (!secret || !body.secret || body.secret !== secret) {
      return jsonOutput_({ ok: false, error: 'Invalid secret' });
    }

    const player = body.player;
    if (PLAYERS.indexOf(player) === -1) {
      return jsonOutput_({ ok: false, error: 'Invalid player' });
    }

    const action = body.action || 'setSnapshot';

    if (action === 'setSnapshot') {
      const snapshot = body.snapshot || {};
      const normalized = {
        items: Array.isArray(snapshot.items) ? snapshot.items : [],
        meta: snapshot && typeof snapshot.meta === 'object' ? snapshot.meta : {},
      };
      writePlayerValue_(SNAPSHOTS_SHEET_NAME, player, normalized);
      return jsonOutput_({
        ok: true,
        action,
        serverTimeUtc: new Date().toISOString(),
        player,
      });
    }

    if (action === 'setHidden') {
      const hidden = Array.isArray(body.hidden)
        ? body.hidden.map((id) => Number(id)).filter((id) => Number.isFinite(id))
        : [];
      writePlayerValue_(HIDDEN_ITEMS_SHEET_NAME, player, hidden);
      return jsonOutput_({
        ok: true,
        action,
        serverTimeUtc: new Date().toISOString(),
        player,
        hiddenCount: hidden.length,
      });
    }

    return jsonOutput_({ ok: false, error: 'Invalid action' });
  } catch (error) {
    return jsonOutput_({ ok: false, error: String(error) });
  }
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function safeParseJson_(value, fallback) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed === null || typeof parsed === 'undefined' ? fallback : parsed;
  } catch (_) {
    return fallback;
  }
}

function getSheetByNameOrCreate_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, 3).setValues([['player', 'json', 'lastUpdatedUtc']]);
  }
  return sheet;
}

function readSheetByPlayer_(sheetName, parseValue) {
  const sheet = getSheetByNameOrCreate_(sheetName);
  const lastRow = sheet.getLastRow();
  const rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 3).getValues() : [];
  const result = {};
  rows.forEach((row) => {
    const player = row[0];
    if (!player) return;
    result[player] = {
      value: parseValue(row[1]),
      lastUpdatedUtc: row[2] || null,
    };
  });
  return result;
}

function writePlayerValue_(sheetName, player, value) {
  const sheet = getSheetByNameOrCreate_(sheetName);
  const now = new Date().toISOString();
  const json = JSON.stringify(value);
  const lastRow = sheet.getLastRow();
  const players = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat() : [];
  const rowIndex = players.findIndex((name) => name === player);
  if (rowIndex >= 0) {
    sheet.getRange(rowIndex + 2, 1, 1, 3).setValues([[player, json, now]]);
  } else {
    sheet.appendRow([player, json, now]);
  }
}
