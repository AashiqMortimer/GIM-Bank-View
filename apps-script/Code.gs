/**
 * OSRS Bank Sync backend for Google Apps Script Web App.
 *
 * Sheet format (sheet name: Snapshots):
 * A: player
 * B: snapshotJson
 * C: lastUpdatedUtc
 */
const SHEET_NAME = 'Snapshots';
const WRITE_SECRET = 'CHANGE_ME_SECRET'; // replace before deploy

function doGet() {
  try {
    const players = ['Ad The Saint', 'Sic Saint'];
    const store = readStore_(players);
    return jsonOutput_({
      serverTimeUtc: new Date().toISOString(),
      players: store,
    });
  } catch (error) {
    return jsonOutput_({ error: String(error) });
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOutput_({ ok: false, error: 'Missing body' });
    }
    const body = JSON.parse(e.postData.contents);
    if (!body.secret || body.secret !== WRITE_SECRET) {
      return jsonOutput_({ ok: false, error: 'Invalid secret' });
    }

    const player = body.player;
    if (player !== 'Ad The Saint' && player !== 'Sic Saint') {
      return jsonOutput_({ ok: false, error: 'Invalid player' });
    }

    const snapshot = body.snapshot || {};
    const normalized = {
      items: Array.isArray(snapshot.items) ? snapshot.items : [],
      meta: snapshot.meta || {},
    };

    writeSnapshot_(player, normalized);

    return jsonOutput_({
      ok: true,
      serverTimeUtc: new Date().toISOString(),
      player,
    });
  } catch (error) {
    return jsonOutput_({ ok: false, error: String(error) });
  }
}

function readStore_(players) {
  const sheet = getOrCreateSheet_();
  const values = sheet.getDataRange().getValues();
  const result = {};

  for (let i = 1; i < values.length; i += 1) {
    const [player, snapshotJson, lastUpdatedUtc] = values[i];
    if (!player) continue;
    result[player] = {
      snapshot: snapshotJson ? JSON.parse(snapshotJson) : { items: [], meta: {} },
      lastUpdatedUtc: lastUpdatedUtc || null,
    };
  }

  players.forEach((player) => {
    if (!result[player]) {
      result[player] = {
        snapshot: { items: [], meta: {} },
        lastUpdatedUtc: null,
      };
    }
  });

  return result;
}

function writeSnapshot_(player, snapshot) {
  const sheet = getOrCreateSheet_();
  const nowIso = new Date().toISOString();
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i += 1) {
    if (values[i][0] === player) {
      sheet.getRange(i + 1, 2).setValue(JSON.stringify(snapshot));
      sheet.getRange(i + 1, 3).setValue(nowIso);
      return;
    }
  }

  sheet.appendRow([player, JSON.stringify(snapshot), nowIso]);
}

function getOrCreateSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['player', 'snapshotJson', 'lastUpdatedUtc']);
  }
  return sheet;
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
