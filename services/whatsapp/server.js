const path = require('path');
// PM2's `env_file` config is silently ignored — load the .env manually so
// WHATSAPP_API_KEY / PORT actually reach the process at boot time.
require('dotenv').config({ path: path.join(__dirname, '.env') });

const Fastify = require('fastify');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs/promises');
const crypto = require('crypto');
const { Jimp } = require('jimp');

const execFileAsync = promisify(execFile);

// Hash phone for logging — first 8 hex chars of SHA-256 (PII safe)
const hashPhone = (p) => p ? crypto.createHash('sha256').update(String(p)).digest('hex').slice(0, 8) : 'null';

const WACLI = '/home/linuxbrew/.linuxbrew/bin/wacli';
const LOG_FILE = path.join(__dirname, 'server.log');
const QR_FILE = path.join(__dirname, 'latest-qr.txt');
const QR_PNG_FILE = path.join(__dirname, 'latest-qr.png');
const STATUS_FILE = path.join(__dirname, 'status.json');
const STATUS_REFRESH_S = 5;

let wacliChild = null;
let qrBase64 = null;
let qrGeneratedAt = null;
let status = { authenticated: false, connected: false, phoneNumber: null };
let statusRefreshTimer = null;

const log = async (msg) => {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  console.log(msg);
  await fs.appendFile(LOG_FILE, line).catch(() => {});
};

// Convert ASCII QR to PNG base64
async function asciiToPngBase64(ascii) {
  const lines = ascii.split('\n').filter(l => l.length > 0);
  const size = lines.length;
  const cols = Math.max(...lines.map(l => [...l].length));
  const rows = lines.length;
  const cellW = 10;
  const cellH = 20;
  const imgWidth = cols * cellW;
  const imgHeight = rows * cellH;

  const image = new Jimp({ width: imgWidth, height: imgHeight, color: 0xffffffff });

  for (let row = 0; row < lines.length; row++) {
    const line = lines[row];
    const chars = [...line];
    for (let col = 0; col < chars.length; col++) {
      const ch = chars[col];
      let topBlack = false;
      let bottomBlack = false;

      if (ch === '█') { topBlack = true; bottomBlack = true; }
      else if (ch === '▀') { topBlack = true; bottomBlack = false; }
      else if (ch === '▄') { topBlack = false; bottomBlack = true; }
      else if (ch === ' ') { topBlack = false; bottomBlack = false; }
      else { topBlack = true; bottomBlack = true; }

      const x = col * cellW;
      const y = row * cellH;
      const half = Math.floor(cellH / 2);

      for (let py = 0; py < half; py++) {
        for (let px = 0; px < cellW; px++) {
          image.setPixelColor(topBlack ? 0x000000ff : 0xffffffff, x + px, y + py);
        }
      }
      for (let py = half; py < cellH; py++) {
        for (let px = 0; px < cellW; px++) {
          image.setPixelColor(bottomBlack ? 0x000000ff : 0xffffffff, x + px, y + py);
        }
      }
    }
  }

  const buffer = await image.getBuffer('image/png');
  return buffer.toString('base64');
}

// Parse full QR from raw stderr output
function parseQrAscii(raw) {
  if (!raw || raw.length < 50) return null;
  const lines = raw.split('\n');
  const qrLines = [];
  for (const line of lines) {
    if (line.includes('█') || line.includes('▀') || line.includes('▄')) {
      qrLines.push(line);
    }
  }
  if (qrLines.length < 15) return null;
  return qrLines.join('\n');
}

async function startWacli() {
  if (wacliChild) {
    log('wacli already running');
    return;
  }

  // QR/auth flow needs exclusive lock — pause the daemon and don't auto-restart
  // until auth completes (the close handler schedules a restart explicitly).
  await stopDaemon();

  log('[wacli] Starting persistent process...');
  wacliChild = spawn(WACLI, ['auth', '--json']);
  let rawAscii = '';
  let qrDetected = false;
  let stderrBuffer = '';
  let stderrTimer = null;

  const tryParseQr = async () => {
    if (qrDetected) return;
    const qr = parseQrAscii(stderrBuffer);
    if (qr) {
      qrDetected = true;
      try {
        const b64 = await asciiToPngBase64(qr);
        qrBase64 = b64;
        qrGeneratedAt = Date.now();
        await fs.writeFile(QR_FILE, qr);
        await fs.writeFile(QR_PNG_FILE, Buffer.from(b64, 'base64'));
        log(`[wacli] QR converted to PNG and saved (${qr.split('\n').length} lines)`);
      } catch (err) {
        log(`[wacli] PNG conversion error: ${err.message}`);
      }
    }
  };

  wacliChild.stdout.on('data', (chunk) => {
    const data = chunk.toString();
    log(`[wacli] stdout: ${data.substring(0, 200)}`);
    try {
      const json = JSON.parse(data.trim());
      if (json.authenticated || (json.data && json.data.authenticated)) {
        log('[wacli] Authenticated - keeping process alive');
        status.authenticated = true;
        writeStatus();
      }
    } catch {}
  });

  wacliChild.stderr.on('data', async (chunk) => {
    const data = chunk.toString();
    log(`[wacli] stderr chunk: ${data.length} chars`);
    stderrBuffer += data;

    // Debounce: espera 800ms sem novos chunks antes de tentar parsear
    if (stderrTimer) clearTimeout(stderrTimer);
    stderrTimer = setTimeout(tryParseQr, 800);
  });

  wacliChild.on('close', (code) => {
    log(`[wacli] Process closed: ${code}`);
    wacliChild = null;
    qrBase64 = null;
    qrGeneratedAt = null;
    // Do NOT auto-respawn: a long-running `wacli auth` holds an exclusive
    // lock on the SQLite store, which blocks every `wacli send` we make
    // from tryWacliSend. After auth completes the wacli process must die so
    // sends can grab the lock.
    //
    // If the auth flow ended with a successful pairing, kick off the sync
    // daemon so we keep the websocket alive going forward.
    if (status.authenticated) {
      log('[wacli] Auth completed — scheduling daemon start');
      scheduleDaemonRestart(1500);
    }
  });

  wacliChild.on('error', (err) => {
    log(`[wacli] Error: ${err.message}`);
    wacliChild = null;
  });
}

function stopWacli() {
  if (wacliChild) {
    log('[wacli] Stopping...');
    wacliChild.kill('SIGTERM');
    wacliChild = null;
  }
  qrBase64 = null;
  qrGeneratedAt = null;
  status = { authenticated: false, connected: false, phoneNumber: null };
}

// ============================================================================
// Daemon + send queue
// ----------------------------------------------------------------------------
// `wacli` is single-shot by design: each `wacli send` opens the SQLite store,
// connects, sends, and closes. That's why the WhatsApp ratchet keys go out of
// sync and the recipient ends up seeing "Aguardando mensagem" placeholders.
//
// To keep the websocket alive between sends, we run `wacli sync --follow` as a
// background daemon. It holds an exclusive lock on the store, which conflicts
// with `wacli send`, so before each send we:
//   1. Stop the daemon (releases the lock)
//   2. Run the send
//   3. Schedule a 1s-delayed daemon restart
//
// Sends are serialized through `sendQueue` to avoid two concurrent sends both
// trying to stop/restart the daemon.
// ============================================================================

let daemonChild = null;
let daemonRestartTimer = null;
let sendQueue = Promise.resolve();

// ----------------------------------------------------------------------------
// Recent-sends cache for retry-receipt redelivery
// ----------------------------------------------------------------------------
// `wacli send` is single-shot: after the message is sent, the process dies and
// the message is no longer in memory. If the recipient's device fails to
// decrypt (typical on the first message after a re-pair) it sends a "retry
// receipt" asking the sender to resend. The retry arrives at the daemon (the
// active websocket) which logs:
//   "Failed to handle retry receipt for ... <msgId>: couldn't find message"
//
// We keep a small in-memory cache of recent sends keyed by msgId; when we see
// that error in daemon stdout we redeliver the message from cache. The
// redelivery rebuilds the e2e session, which usually unsticks "Aguardando
// mensagem" on the recipient.
// ----------------------------------------------------------------------------

const RECENT_TTL_MS = 5 * 60 * 1000; // keep msgs 5 min — long enough for retry
const MAX_REDELIVERIES = 2;          // cap to avoid loops
const recentSends = new Map();       // msgId -> { to, message, sentAt, redeliveries }

function rememberSend(msgId, to, message, redeliveries = 0) {
  if (!msgId) return;
  recentSends.set(msgId, { to, message, sentAt: Date.now(), redeliveries });
  // Lazy cleanup: drop entries older than TTL
  const cutoff = Date.now() - RECENT_TTL_MS;
  for (const [k, v] of recentSends) {
    if (v.sentAt < cutoff) recentSends.delete(k);
  }
}

async function handleRetryReceipt(msgId) {
  const entry = recentSends.get(msgId);
  if (!entry) {
    log(`[retry] no cache entry for ${msgId} — cannot redeliver`);
    return;
  }
  if (entry.redeliveries >= MAX_REDELIVERIES) {
    log(`[retry] ${msgId} reached max redeliveries (${MAX_REDELIVERIES}), giving up`);
    recentSends.delete(msgId);
    return;
  }
  const nextCount = entry.redeliveries + 1;
  log(`[retry] redelivering ${msgId} to ${hashPhone(entry.to)} (attempt ${nextCount}/${MAX_REDELIVERIES})`);
  // Mark the old msgId as exhausted *before* sending so a duplicate retry
  // receipt for the same id (sent by the recipient device while we redeliver)
  // does not trigger another redelivery.
  recentSends.delete(msgId);
  try {
    const result = await tryWacliSend(entry.to, entry.message);
    if (result.success && result.messageId) {
      log(`[retry] redelivery success: ${msgId} → new msgId ${result.messageId}`);
      // Carry the counter forward so the chain stops at MAX_REDELIVERIES
      // overall, not per-msgId.
      rememberSend(result.messageId, entry.to, entry.message, nextCount);
    } else {
      log(`[retry] redelivery failed: ${result.error || 'no msgId'}`);
    }
  } catch (err) {
    log(`[retry] redelivery exception: ${err.message}`);
  }
}

// Match: "Failed to handle retry receipt for <jid>/<msgId> from <jid>: couldn't find message"
const RETRY_RECEIPT_RE = /Failed to handle retry receipt for [^/]+\/([A-F0-9]+)/i;

function scanForRetryReceipts(text) {
  if (!text) return;
  const lines = text.split('\n');
  for (const line of lines) {
    const m = line.match(RETRY_RECEIPT_RE);
    if (m) {
      const msgId = m[1];
      log(`[retry] detected retry receipt for ${msgId}`);
      // Fire-and-forget; redelivery is queued via withDaemonPaused so it
      // serializes with any in-flight sends.
      handleRetryReceipt(msgId).catch((err) => log(`[retry] handler error: ${err.message}`));
    }
  }
}

function spawnDaemon() {
  if (daemonChild) return;
  if (!status.authenticated) {
    log('[daemon] not authenticated, skipping daemon start');
    return;
  }
  log('[daemon] starting wacli sync --follow');
  try {
    daemonChild = spawn(WACLI, ['sync', '--follow', '--json']);
  } catch (err) {
    log(`[daemon] spawn failed: ${err.message}`);
    daemonChild = null;
    return;
  }
  daemonChild.stdout.on('data', (chunk) => {
    const data = chunk.toString().trim();
    if (data) log(`[daemon] stdout: ${data.substring(0, 200)}`);
    scanForRetryReceipts(data);
  });
  daemonChild.stderr.on('data', (chunk) => {
    const data = chunk.toString().trim();
    if (data) log(`[daemon] stderr: ${data.substring(0, 200)}`);
    scanForRetryReceipts(data);
  });
  daemonChild.on('close', (code) => {
    log(`[daemon] exited: ${code}`);
    daemonChild = null;
  });
  daemonChild.on('error', (err) => {
    log(`[daemon] error: ${err.message}`);
    daemonChild = null;
  });
}

async function stopDaemon() {
  if (daemonRestartTimer) {
    clearTimeout(daemonRestartTimer);
    daemonRestartTimer = null;
  }
  if (!daemonChild) return;
  const child = daemonChild;
  daemonChild = null;
  log('[daemon] stopping');
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    try {
      child.once('exit', finish);
      child.kill('SIGTERM');
    } catch {
      finish();
      return;
    }
    setTimeout(() => {
      if (done) return;
      try { child.kill('SIGKILL'); } catch {}
    }, 2000);
    setTimeout(finish, 3000);
  });
}

function scheduleDaemonRestart(delayMs = 1000) {
  if (daemonRestartTimer) clearTimeout(daemonRestartTimer);
  daemonRestartTimer = setTimeout(() => {
    daemonRestartTimer = null;
    spawnDaemon();
  }, delayMs);
}

/**
 * Serializes work that needs the SQLite store unlocked: stops the daemon,
 * runs `fn`, then schedules the daemon to come back online.
 */
async function withDaemonPaused(fn) {
  const next = sendQueue.then(async () => {
    await stopDaemon();
    try {
      return await fn();
    } finally {
      scheduleDaemonRestart(1000);
    }
  });
  // Don't propagate one send's failure to others queued behind it.
  sendQueue = next.catch(() => {});
  return next;
}

async function writeStatus() {
  try {
    await fs.writeFile(STATUS_FILE, JSON.stringify(status));
  } catch (err) {
    log(`[status] Write error: ${err.message}`);
  }
}

function getPhoneFromDb() {
  try {
    const { execFileSync } = require('child_process');
    const result = execFileSync('/home/linuxbrew/.linuxbrew/bin/sqlite3', ['/home/sidney/.wacli/session.db', 'SELECT jid FROM whatsmeow_device LIMIT 1;'], { timeout: 3000 }).toString().trim();
    if (result) {
      const match = result.match(/^55(\d+):/);
      if (match) return '+55 ' + match[1].replace(/(\d{2})(\d{4,5})(\d{4})/, '$1 $2-$3');
    }
  } catch(e) { console.log("[phone] erro:", e.message); }
  return null;
}

async function refreshStatus() {
  try {
    const { stdout } = await execFileAsync(WACLI, ['doctor', '--json'], {
      timeout: 10000,
      maxBuffer: 1024 * 1024
    });
    const data = JSON.parse(stdout);
    const d = data.data || data;
    status.authenticated = d.authenticated || false;
    // `connected` reflects whether we have a live websocket. We can't trust
    // `wacli doctor`'s `connected` field while the sync daemon holds the
    // SQLite lock — doctor opens its own short-lived session and reports
    // false even though the daemon's socket is fine. So treat the daemon
    // process being alive as authoritative for "connected"; fall back to
    // doctor's value when the daemon isn't running.
    status.connected = (status.authenticated && daemonChild !== null) || d.connected || false;
    status.phoneNumber = d.phoneNumber || getPhoneFromDb();
    writeStatus();
    log(`[status] Refreshed: authenticated=${status.authenticated} connected=${status.connected} phone=${hashPhone(status.phoneNumber)}`);
    // Watchdog: if we're authenticated but the daemon isn't running and no
    // restart is scheduled, kick one off. Covers the case where wacli was
    // re-paired out-of-band or the daemon died silently.
    if (status.authenticated && !daemonChild && !daemonRestartTimer && !wacliChild) {
      log('[status] Authenticated without daemon — scheduling start');
      scheduleDaemonRestart(1000);
    }
  } catch (err) {
    log(`[status] Refresh error: ${err.message}`);
  }
}

const API_KEY = process.env.INTERNAL_API_SECRET || process.env.WHATSAPP_API_KEY || '';

const fastify = Fastify({ logger: false });

fastify.get('/health', async () => ({ status: 'ok' }));

async function requireAuth(req, reply) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  const token = authHeader.slice(7);
  if (token !== API_KEY) {
    return reply.code(403).send({ error: 'Forbidden' });
  }
}

async function tryWacliSend(phone, message) {
  return withDaemonPaused(() => doWacliSend(phone, message));
}

async function doWacliSend(phone, message) {
  try {
    const cleanMessage = message.replace(/\n/g, ' ').trim();
    // Converte 9 digitos para 8 se necessário (Brasil)
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 13 && cleaned.startsWith('55')) {
      const ddd = cleaned.substring(2, 4);
      const num8 = cleaned.substring(5);
      phone = '55' + ddd + num8;
    }
    const { stdout, stderr } = await execFileAsync(
      WACLI,
      ['send', 'text', '--to', phone, '--message', cleanMessage, '--json'],
      { timeout: 15000 }
    );
    const output = (stdout + stderr + '').trim();
    const jsonMatch = output.match(/\{.*\}/s);
    if (!jsonMatch) {
      return { success: false, error: 'No JSON in wacli output' };
    }
    const result = JSON.parse(jsonMatch[0]);
    // wacli may return success:true without actually delivering
    // Check messages_stored when available to detect false positives
    const stored = result.data?.messages_stored ?? result.messages_stored ?? 0;
    const hasStoredField = ('messages_stored' in (result.data || {})) || ('messages_stored' in result);
    const success = hasStoredField ? (stored > 0) : (result.success === true);
    const messageId = result.data?.id;
    if (success && messageId) {
      // Cache so we can redeliver if the daemon receives a retry receipt
      // (recipient device couldn't decrypt and asked for resend).
      rememberSend(messageId, phone, cleanMessage);
    }
    return {
      success,
      messageId,
      error: result.error
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function sendWithFallback(phone, message) {
  const cleaned = phone.replace(/\D/g, '');

  const result1 = await tryWacliSend(cleaned, message);
  if (result1.success) return result1;

  if (cleaned.length === 13 && cleaned.startsWith('55')) {
    const ddd = cleaned.substring(2, 4);
    const num9 = cleaned.substring(4);
    const num8 = num9.substring(1);
    const phone8 = '55' + ddd + num8;
    log(`[send] Trying 8-digit fallback: ${hashPhone(phone8)}`);
    const result2 = await tryWacliSend(phone8, message);
    if (result2.success) return result2;
  }

  if (cleaned.length === 12 && cleaned.startsWith('55')) {
    const ddd = cleaned.substring(2, 4);
    const num8 = cleaned.substring(4);
    const phone9 = '55' + ddd + '9' + num8;
    log(`[send] Trying 9-digit fallback: ${hashPhone(phone9)}`);
    const result2 = await tryWacliSend(phone9, message);
    if (result2.success) return result2;
  }

  return result1;
}

fastify.get('/api/whatsapp/status', { onRequest: requireAuth }, async (req, reply) => {
  await refreshStatus();
  return reply.send(status);
});

fastify.post('/api/whatsapp/qr', { onRequest: requireAuth }, async (req, reply) => {
  const now = Date.now();

  if (qrBase64 && qrGeneratedAt && (now - qrGeneratedAt) < 60000) {
    log(`[QR] Serving cached PNG QR (age: ${now - qrGeneratedAt}ms)`);
    return reply.send({ qr: qrBase64, format: 'png_base64', expiresAt: qrGeneratedAt + 60000 });
  }

  if (!wacliChild) {
    await startWacli();
  }

  const waitStart = Date.now();
  while ((!qrBase64 || (now - qrGeneratedAt) >= 60000) && (Date.now() - waitStart) < 8000) {
    await new Promise(r => setTimeout(r, 500));
  }

  if (qrBase64 && qrGeneratedAt && (now - qrGeneratedAt) < 60000) {
    log(`[QR] PNG QR ready after ${Date.now() - waitStart}ms`);
    return reply.send({ qr: qrBase64, format: 'png_base64', expiresAt: qrGeneratedAt + 60000 });
  }

  log('[QR] Timeout waiting for QR');
  return reply.code(504).send({ error: 'QR generation timeout' });
});

fastify.post('/api/whatsapp/send', { onRequest: requireAuth }, async (req, reply) => {
  const { to, message } = req.body;
  if (!to || !message) {
    return reply.code(400).send({ error: 'Missing to or message' });
  }

  const result = await sendWithFallback(to, message);

  if (!result.success) {
    log(`[send] Error: ${result.error}`);
    return reply.code(500).send({ error: 'Failed to send message', details: result.error });
  }

  log(`[send] Success: ${hashPhone(to)} (msgId: ${result.messageId})`);
  return reply.send({ success: true, messageId: result.messageId });
});

fastify.post('/api/whatsapp/disconnect', { onRequest: requireAuth }, async (req, reply) => {
  log('[disconnect] Requested');
  stopWacli();
  // wacli has no "logout" command — delete session files instead
  try {
    const wacliDir = path.join(require('os').homedir(), '.wacli');
    const files = ['session.db', 'wacli.db', 'LOCK'];
    for (const f of files) {
      try { await fs.unlink(path.join(wacliDir, f)); } catch {}
      try { await fs.unlink(path.join(wacliDir, '.wacli', f)); } catch {}
    }
    log('[disconnect] Session files deleted');
  } catch (err) {
    log(`[disconnect] Cleanup error: ${err.message}`);
  }
  try { await fs.unlink(QR_FILE); } catch {}
  try { await fs.unlink(QR_PNG_FILE); } catch {}
  status = { authenticated: false, connected: false, phoneNumber: null };
  writeStatus();
  return reply.send({ success: true });
});

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3457', 10);
    await fastify.listen({ port, host: '0.0.0.0' });
    log(`WhatsApp API server running on port ${port}`);
    statusRefreshTimer = setInterval(refreshStatus, STATUS_REFRESH_S * 1000);
    // On boot, check if wacli is already authenticated and start the sync daemon
    // so ratchet keys stay fresh even after a PM2 restart.
    await refreshStatus();
    if (status.authenticated) {
      log('[boot] Already authenticated — starting sync daemon');
      spawnDaemon();
    }
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      log(`FATAL: Port ${process.env.PORT || 3457} already in use. Another process is occupying it. Stopping to avoid restart loop.`);
      // Stop PM2 from restarting by exiting with code 0
      // PM2 will not restart on graceful exit
      process.exit(0);
    }
    log(`Server error: ${err.message}`);
    process.exit(1);
  }
};

start();

process.on('SIGINT', () => { stopWacli(); if (statusRefreshTimer) clearInterval(statusRefreshTimer); process.exit(0); });
process.on('SIGTERM', () => { stopWacli(); if (statusRefreshTimer) clearInterval(statusRefreshTimer); process.exit(0); });
