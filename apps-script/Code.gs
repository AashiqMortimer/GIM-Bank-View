/**
 * OSRS Bank Sync backend for Google Apps Script Web App.
 *
 * Sheet format (sheet name: Snapshots):
 * A: player
 * B: snapshotJson
 * C: lastUpdatedUtc
 */

const SHEET_NAME = 'Snapshots';

function getWriteSecret_() {
  return PropertiesService.getScriptProperties().getProperty('WRITE_SECRET');
}

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

    const secret = getWriteSecret_();
    if (!secret || !body.secret || body.secret !== secret) {
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
