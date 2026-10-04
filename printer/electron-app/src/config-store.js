// Read/merge/write of config.json, split out of main.js so it can be tested
// without booting Electron.
//
// WHY THIS IS ITS OWN MODULE
//
// config.json has several writers with very different views of it. The print
// server owns the security and realtime keys (phonePin, lanAccess,
// allowedOrigins, pusherAppId/Key/Secret/Cluster), the operator schedule, and
// assorted preferences (historyRetentionDays, connectCard,
// connectCardAutoFirstTimer, connectCardGreeting, worksheetPrinter,
// firstTimerInverted, labelFooter, labelTemplates). The Electron setup wizard
// owns exactly three:
// printerName, checkinUrl, launchOnBoot.
//
// The Electron writer used to do a bare whole-file `writeFileSync(path,
// JSON.stringify(config))` with the renderer's three-key object. So a single
// click on Save in the settings window deleted every server-owned key, and
// because the caller restarts the server immediately afterwards, the loss went
// live at once: the LAN auth gate fails closed with no PIN, so phone check-in
// refused every request; the lobby display lost its Pusher credentials; and
// late arrivals stopped being routed because the schedule was gone. The
// realistic trigger is the worst possible moment — the printer jams mid-event,
// a volunteer opens Settings to pick the backup printer, and clicks Save.
//
// So: writes are always a MERGE of a patch over what is on disk, and always
// tmp + fsync + rename, so a crash mid-write cannot truncate the file either.
//
// AND A DAMAGED FILE IS RECOVERED, NOT WRITTEN OVER (7.11.1). A truncated
// config.json (a power cut mid-write, by this app or by the print server, which
// used to write it in place) read as "no config", so Save merged the three
// wizard keys over {} and the PIN, display key and sync sign-in were gone.
// Every write now keeps the file it replaces as config.json.bak; a read that
// fails restores that backup; a file that cannot be read and has no usable
// backup is moved aside (config.json.damaged-<time>), so what it held can still
// be copied back by hand.
const fs = require('fs');
const path = require('path');

const bakPath = (configPath) => `${configPath}.bak`;

function parseConfig(text) {
  const parsed = JSON.parse(text);
  // A JSON scalar or array is not a config. Treat it like a missing file
  // rather than merging a patch into it and writing something nonsensical.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed;
}

// The config on disk, or null when there is none to be read. A file that
// cannot be read is restored from its .bak when that parses; the restored
// config is returned. Nothing is moved aside here: reading never destroys.
function loadConfig(configPath) {
  let text;
  try { text = fs.readFileSync(configPath, 'utf8'); } catch { return null; }
  try {
    const parsed = parseConfig(text);
    if (parsed) return parsed;
  } catch { /* damaged: try the backup */ }
  try {
    const bak = parseConfig(fs.readFileSync(bakPath(configPath), 'utf8'));
    if (bak) {
      fs.copyFileSync(bakPath(configPath), configPath);
      return bak;
    }
  } catch { /* no usable backup */ }
  return null;
}

// Merge `patch` over the on-disk config and persist the result. Returns the
// merged object — callers must act on THIS, not on the patch, because the patch
// on its own is missing everything the server needs to start.
function saveConfig(configPath, patch) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  let base = loadConfig(configPath);
  if (base === null && fs.existsSync(configPath)) {
    // Damaged, and no backup could stand in for it: keep it, under another
    // name, rather than write the patch over whatever it still holds.
    const aside = `${configPath}.damaged-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    try { fs.renameSync(configPath, aside); } catch { /* the write below replaces it */ }
    base = {};
  }
  const merged = Object.assign({}, base || {}, patch || {});
  const tmp = `${configPath}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(merged, null, 2), null, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  // The file being replaced is the last good one: it becomes the backup.
  try { if (fs.existsSync(configPath)) fs.copyFileSync(configPath, bakPath(configPath)); } catch { /* best effort */ }
  fs.renameSync(tmp, configPath);
  return merged;
}

module.exports = { loadConfig, saveConfig };
