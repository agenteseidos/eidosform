'use strict';

const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile, execFileSync } = require('child_process');
const { promisify } = require('util');
const fs = require('fs/promises');
const { Jimp } = require('jimp');
const { ERROR_CLASS, brazilianPhoneCandidates, formatBrazilianPhone } = require('./transport');

const execFileAsync = promisify(execFile);

function safeExecError(err) {
  if (!err || typeof err !== 'object') return 'wacli_failed';
  if (err.killed === true || err.signal) return 'wacli_timeout_or_killed';
  if (typeof err.code === 'string') return `wacli_spawn_${err.code}`;
  if (Number.isInteger(err.code)) return `wacli_exit_${err.code}`;
  return 'wacli_failed';
}

function classifyWacliFailure(code, raw = '') {
  const text = String(raw || '').toLowerCase();
  if (code === 'wacli_timeout_or_killed') {
    return { error: code, errorClass: ERROR_CLASS.IN_FLIGHT };
  }
  if (code === 'wacli_spawn_ENOENT' || code === 'wacli_spawn_EACCES') {
    return { error: code, errorClass: ERROR_CLASS.PRE_FLIGHT };
  }
  if (text.includes('not authenticated') || text.includes('not logged') || text.includes('no session')) {
    return { error: 'wacli_session_not_ready', errorClass: ERROR_CLASS.PRE_FLIGHT };
  }
  if (text.includes('invalid') && (text.includes('phone') || text.includes('jid') || text.includes('recipient'))) {
    return {
      error: 'wacli_invalid_recipient',
      errorClass: ERROR_CLASS.PERMANENTE,
      retryAlternateNumber: true,
    };
  }
  if (code.startsWith('wacli_exit_') || code === 'wacli_no_json') {
    return { error: code, errorClass: ERROR_CLASS.IN_FLIGHT };
  }
  return { error: 'wacli_failed', errorClass: ERROR_CLASS.IN_FLIGHT };
}

function createWacliTransport({
  log,
  hashPhone,
  baseDir = __dirname,
  wacliPath = process.env.WACLI_PATH || '/home/linuxbrew/.linuxbrew/bin/wacli',
  sqlitePath = process.env.SQLITE3_PATH || '/home/linuxbrew/.linuxbrew/bin/sqlite3',
  sessionDb = process.env.WACLI_SESSION_DB || path.join(os.homedir(), '.wacli', 'session.db'),
} = {}) {
  const qrFile = path.join(baseDir, 'latest-qr.txt');
  const qrPngFile = path.join(baseDir, 'latest-qr.png');
  let authChild = null;
  let daemonChild = null;
  let daemonRestartTimer = null;
  let sendQueue = Promise.resolve();
  let sendInFlight = 0;
  let qrBase64 = null;
  let qrGeneratedAt = null;
  let status = { authenticated: false, connected: false, phone: null, available: true, error: null };

  const recentSends = new Map();
  const recentRedeliveries = new Map();
  const recentTtlMs = 5 * 60 * 1000;
  const dedupWindowMs = 60 * 1000;
  const maxRedeliveries = 1;

  const dedupKey = (to, message) => `${to}|${crypto.createHash('sha256').update(String(message)).digest('hex').slice(0, 16)}`;

  function rememberSend(msgId, to, message, redeliveries = 0) {
    if (!msgId) return;
    recentSends.set(msgId, { to, message, sentAt: Date.now(), redeliveries });
    const cutoff = Date.now() - recentTtlMs;
    for (const [key, value] of recentSends) if (value.sentAt < cutoff) recentSends.delete(key);
    const dedupCutoff = Date.now() - dedupWindowMs;
    for (const [key, timestamp] of recentRedeliveries) {
      if (timestamp < dedupCutoff) recentRedeliveries.delete(key);
    }
  }

  async function asciiToPngBase64(ascii) {
    const lines = ascii.split('\n').filter((line) => line.length > 0);
    const cols = Math.max(...lines.map((line) => [...line].length));
    const cellW = 10;
    const cellH = 20;
    const image = new Jimp({ width: cols * cellW, height: lines.length * cellH, color: 0xffffffff });
    for (let row = 0; row < lines.length; row++) {
      const chars = [...lines[row]];
      for (let col = 0; col < chars.length; col++) {
        const char = chars[col];
        const topBlack = char === '█' || char === '▀' || !['▄', ' '].includes(char);
        const bottomBlack = char === '█' || char === '▄' || !['▀', ' '].includes(char);
        const x = col * cellW;
        const y = row * cellH;
        const half = Math.floor(cellH / 2);
        for (let py = 0; py < cellH; py++) {
          for (let px = 0; px < cellW; px++) {
            const black = py < half ? topBlack : bottomBlack;
            image.setPixelColor(black ? 0x000000ff : 0xffffffff, x + px, y + py);
          }
        }
      }
    }
    return (await image.getBuffer('image/png')).toString('base64');
  }

  function parseQrAscii(raw) {
    if (!raw || raw.length < 50) return null;
    const lines = raw.split('\n').filter((line) => line.includes('█') || line.includes('▀') || line.includes('▄'));
    return lines.length >= 15 ? lines.join('\n') : null;
  }

  function getPhoneFromDb() {
    try {
      const result = execFileSync(sqlitePath, [
        sessionDb,
        'SELECT jid FROM whatsmeow_device LIMIT 1;',
      ], { timeout: 3000 }).toString().trim();
      const match = result.match(/^(\d+)[:@]/);
      if (match) return formatBrazilianPhone(match[1]);
    } catch {
      log('[phone] wacli session phone unavailable');
    }
    return null;
  }

  async function obterStatus() {
    try {
      const { stdout } = await execFileAsync(wacliPath, ['doctor', '--json'], {
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      });
      const parsed = JSON.parse(stdout);
      const data = parsed.data || parsed;
      status = {
        authenticated: data.authenticated === true,
        connected: (data.authenticated === true && daemonChild !== null) || data.connected === true,
        phone: data.phoneNumber || getPhoneFromDb(),
        available: true,
        error: null,
      };
      log(`[status:wacli] authenticated=${status.authenticated} connected=${status.connected} phone=${hashPhone(status.phone)}`);
      if (status.authenticated && !daemonChild && !daemonRestartTimer && !authChild && sendInFlight === 0) {
        scheduleDaemonRestart(1000);
      }
      return { ...status };
    } catch (err) {
      const code = safeExecError(err);
      status = { ...status, connected: false, available: false, error: code };
      log(`[status:wacli] refresh failed: ${code}`);
      return { ...status };
    }
  }

  function scanForRetryReceipts(text) {
    if (!text) return;
    const regex = /Failed to handle retry receipt for [^/]+\/([A-F0-9]+)/i;
    for (const line of text.split('\n')) {
      const match = line.match(regex);
      if (match) {
        log(`[retry] detected retry receipt for ${match[1]}`);
        handleRetryReceipt(match[1]).catch(() => log('[retry] handler failed'));
      }
    }
  }

  async function handleRetryReceipt(msgId) {
    const entry = recentSends.get(msgId);
    if (!entry) {
      log(`[retry] no cache entry for ${msgId}`);
      return;
    }
    if (entry.redeliveries >= maxRedeliveries) {
      recentSends.delete(msgId);
      return;
    }
    const key = dedupKey(entry.to, entry.message);
    const last = recentRedeliveries.get(key);
    if (last && Date.now() - last < dedupWindowMs) {
      recentSends.delete(msgId);
      return;
    }
    const nextCount = entry.redeliveries + 1;
    log(`[retry] redelivering ${msgId} to ${hashPhone(entry.to)} (attempt ${nextCount}/${maxRedeliveries})`);
    recentRedeliveries.set(key, Date.now());
    recentSends.delete(msgId);
    const result = await enviarTexto(entry.to, entry.message);
    if (result.success && result.messageId) {
      rememberSend(result.messageId, entry.to, entry.message, nextCount);
    } else {
      log(`[retry] redelivery failed: ${result.error || 'wacli_failed'}`);
    }
  }

  function spawnDaemon() {
    if (daemonChild) return;
    if (sendInFlight > 0) {
      scheduleDaemonRestart(1000);
      return;
    }
    if (!status.authenticated) return;
    log('[daemon] starting wacli sync --follow');
    try {
      daemonChild = spawn(wacliPath, ['sync', '--follow', '--json']);
    } catch {
      daemonChild = null;
      log('[daemon] spawn failed');
      return;
    }
    daemonChild.stdout.on('data', (chunk) => scanForRetryReceipts(chunk.toString()));
    daemonChild.stderr.on('data', (chunk) => scanForRetryReceipts(chunk.toString()));
    daemonChild.on('close', (code) => {
      log(`[daemon] exited: ${code}`);
      daemonChild = null;
    });
    daemonChild.on('error', () => {
      log('[daemon] process error');
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
    await new Promise((resolve) => {
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
        if (!done) {
          try { child.kill('SIGKILL'); } catch {}
        }
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

  async function withDaemonPaused(fn) {
    const next = sendQueue.then(async () => {
      sendInFlight += 1;
      await stopDaemon();
      try {
        return await fn();
      } finally {
        sendInFlight -= 1;
        scheduleDaemonRestart(1000);
      }
    });
    sendQueue = next.catch(() => {});
    return next;
  }

  async function doSend(phone, message) {
    try {
      const cleanMessage = String(message).replace(/\r\n?/g, '\n').trim();
      const target = String(phone).replace(/\D/g, '');
      const { stdout, stderr } = await execFileAsync(
        wacliPath,
        ['send', 'text', '--to', target, '--message', cleanMessage, '--json'],
        { timeout: 15_000 },
      );
      const output = `${stdout}${stderr || ''}`.trim();
      let result;
      const lines = output.split('\n');
      for (let index = lines.length - 1; index >= 0; index--) {
        const line = lines[index].trim();
        if (!line.startsWith('{')) continue;
        try {
          result = JSON.parse(line);
          break;
        } catch {}
      }
      if (!result) return { success: false, ...classifyWacliFailure('wacli_no_json') };
      const data = result.data || {};
      const stored = data.messages_stored ?? result.messages_stored ?? 0;
      const hasStored = Object.hasOwn(data, 'messages_stored') || Object.hasOwn(result, 'messages_stored');
      const success = hasStored ? stored > 0 : result.success === true;
      const messageId = data.id ?? result.id ?? result.messageId ?? null;
      if (success && messageId) {
        rememberSend(messageId, target, cleanMessage);
        return { success: true, messageId, error: null, errorClass: null };
      }
      return { success: false, ...classifyWacliFailure('wacli_rejected', result.error) };
    } catch (err) {
      const code = safeExecError(err);
      return { success: false, ...classifyWacliFailure(code) };
    }
  }

  async function enviarTexto(phone, message) {
    return withDaemonPaused(() => doSend(phone, message));
  }

  async function startAuth() {
    if (authChild) return;
    await stopDaemon();
    log('[wacli] starting auth process');
    authChild = spawn(wacliPath, ['auth', '--json']);
    let stderrBuffer = '';
    let parseTimer = null;
    const parse = async () => {
      const qr = parseQrAscii(stderrBuffer);
      if (!qr) return;
      try {
        qrBase64 = await asciiToPngBase64(qr);
        qrGeneratedAt = Date.now();
        await fs.writeFile(qrFile, qr, { mode: 0o600 });
        await fs.writeFile(qrPngFile, Buffer.from(qrBase64, 'base64'), { mode: 0o600 });
        log('[wacli] QR generated');
      } catch {
        log('[wacli] QR conversion failed');
      }
    };
    authChild.stdout.on('data', (chunk) => {
      try {
        const parsed = JSON.parse(chunk.toString().trim());
        const data = parsed.data || parsed;
        if (data.authenticated) status.authenticated = true;
      } catch {}
    });
    authChild.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString();
      if (parseTimer) clearTimeout(parseTimer);
      parseTimer = setTimeout(parse, 800);
    });
    authChild.on('close', () => {
      authChild = null;
      qrBase64 = null;
      qrGeneratedAt = null;
      if (status.authenticated) scheduleDaemonRestart(1500);
    });
    authChild.on('error', () => {
      authChild = null;
      log('[wacli] auth process error');
    });
  }

  async function obterQR() {
    const current = await obterStatus();
    if (current.authenticated) return null;
    const now = Date.now();
    if (qrBase64 && qrGeneratedAt && now - qrGeneratedAt < 60_000) {
      return { qr: qrBase64, format: 'png_base64', expiresAt: qrGeneratedAt + 60_000 };
    }
    if (!authChild) await startAuth();
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      if (qrBase64 && qrGeneratedAt && Date.now() - qrGeneratedAt < 60_000) {
        return { qr: qrBase64, format: 'png_base64', expiresAt: qrGeneratedAt + 60_000 };
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    const error = new Error('wacli_qr_timeout');
    error.safeCode = 'wacli_qr_timeout';
    throw error;
  }

  async function stopAuth() {
    if (authChild) {
      try { authChild.kill('SIGTERM'); } catch {}
      authChild = null;
    }
    qrBase64 = null;
    qrGeneratedAt = null;
  }

  async function desconectar() {
    await stopAuth();
    await stopDaemon();
    const wacliDir = path.join(os.homedir(), '.wacli');
    for (const file of ['session.db', 'wacli.db', 'LOCK']) {
      try { await fs.unlink(path.join(wacliDir, file)); } catch {}
      try { await fs.unlink(path.join(wacliDir, '.wacli', file)); } catch {}
    }
    try { await fs.unlink(qrFile); } catch {}
    try { await fs.unlink(qrPngFile); } catch {}
    status = { authenticated: false, connected: false, phone: null, available: true, error: null };
    log('[disconnect:wacli] session files deleted');
    return { ok: true };
  }

  async function start() {
    const current = await obterStatus();
    if (current.authenticated) spawnDaemon();
  }

  async function shutdown() {
    await stopAuth();
    await stopDaemon();
  }

  return {
    name: 'wacli',
    // Mantém o primeiro formato usado historicamente em produção (8 dígitos),
    // mas permite que a segunda tentativa seja realmente a variante de 9.
    // A regra é COMPARTILHADA com os demais motores de propósito (transport.js).
    phoneCandidates: brazilianPhoneCandidates,
    enviarTexto,
    obterStatus,
    obterQR,
    desconectar,
    start,
    shutdown,
  };
}

module.exports = {
  createWacliTransport,
  safeExecError,
  classifyWacliFailure,
};
