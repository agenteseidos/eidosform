'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const Fastify = require('fastify');
const fs = require('fs/promises');
const crypto = require('crypto');

const { createIdempotencyStore } = require('./idempotency');
const { createWacliTransport, safeExecError } = require('./transport-wacli');
const { createWuzapiTransport } = require('./transport-wuzapi');
const {
  normalizeTransportName,
  sendWithTransportFallback,
} = require('./transport');
const { createTransportMetricsStore } = require('./transport-metrics');
const { sendFallbackAlert } = require('./fallback-alert');

const LOG_FILE = path.join(__dirname, 'server.log');
const STATUS_FILE = path.join(__dirname, 'status.json');
const IDEMP_FILE = path.join(__dirname, 'sent-keys.json');
const METRICS_FILE = path.join(__dirname, 'transport-metrics.json');
const IDEMP_TTL_MS = 96 * 3600 * 1000;
const MAX_IDEMP_ACQUIRE_ATTEMPTS = 5;
const STATUS_REFRESH_MS = 5_000;

const hashValue = (value) => value
  ? crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8)
  : 'null';
const hashPhone = hashValue;

const log = async (message) => {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  console.log(message);
  await fs.appendFile(LOG_FILE, line).catch(() => {});
};

const idemp = createIdempotencyStore({
  file: IDEMP_FILE,
  ttlMs: IDEMP_TTL_MS,
  maxAcquireAttempts: MAX_IDEMP_ACQUIRE_ATTEMPTS,
  log: (message) => log(message),
  sanitizeError: (err) => safeExecError(err),
});
idemp.load();

const metrics = createTransportMetricsStore({
  file: METRICS_FILE,
  log: (message) => log(message),
});

const transportMap = {
  wacli: createWacliTransport({ log, hashPhone, baseDir: __dirname }),
  wuzapi: createWuzapiTransport(),
};

const primaryName = normalizeTransportName(process.env.WHATSAPP_TRANSPORT, 'wacli');
const fallbackCandidate = normalizeTransportName(process.env.WHATSAPP_TRANSPORT_FALLBACK, '');
const fallbackName = fallbackCandidate && fallbackCandidate !== primaryName ? fallbackCandidate : null;
const primaryTransport = transportMap[primaryName];
const fallbackTransport = fallbackName ? transportMap[fallbackName] : null;

let statusRefreshTimer = null;
let statusCache = {
  wacli: { authenticated: false, connected: false, phone: null, available: true, error: null },
  wuzapi: { authenticated: false, connected: false, phone: null, available: false, error: null },
};

async function seedMetricsFromLegacyStore() {
  let entries = {};
  try {
    entries = JSON.parse(await fs.readFile(IDEMP_FILE, 'utf8'));
  } catch {}
  await metrics.seedLegacy(entries);
}

async function refreshStatuses() {
  const names = Object.keys(transportMap);
  const results = await Promise.all(names.map(async (name) => {
    try {
      return [name, await transportMap[name].obterStatus()];
    } catch {
      return [name, {
        authenticated: false,
        connected: false,
        phone: null,
        available: false,
        error: `${name}_status_failed`,
      }];
    }
  }));
  statusCache = Object.fromEntries(results);
  await writeStatusFile();
  return statusCache;
}

function publicTransportStatus(name) {
  const current = statusCache[name] || {};
  return {
    authenticated: current.authenticated === true,
    connected: current.connected === true,
    phoneNumber: current.phone || null,
    available: current.available !== false,
    error: current.error || null,
  };
}

function buildStatusResponse() {
  const primary = publicTransportStatus(primaryName);
  const snapshot = metrics.snapshot();
  return {
    // Contrato legado: continua representando o motor primário configurado.
    authenticated: primary.authenticated,
    connected: primary.connected,
    phoneNumber: primary.phoneNumber,
    primaryTransport: primaryName,
    fallbackTransport: fallbackName,
    activeTransport: snapshot.active.transport,
    activeSince: snapshot.active.since,
    fallbackActive: snapshot.active.fallback,
    fallbackReason: snapshot.active.reason,
    fallbackIncident: snapshot.fallbackIncident,
    transports: {
      wacli: publicTransportStatus('wacli'),
      wuzapi: publicTransportStatus('wuzapi'),
    },
    volume: snapshot.volume,
    sendsByTransport: snapshot.sendsByTransport,
    metricsInitializedAt: snapshot.initializedAt,
  };
}

async function writeStatusFile() {
  try {
    const primary = publicTransportStatus(primaryName);
    await fs.writeFile(STATUS_FILE, JSON.stringify({
      authenticated: primary.authenticated,
      connected: primary.connected,
      phoneNumber: primary.phoneNumber,
      primaryTransport: primaryName,
      fallbackTransport: fallbackName,
    }), { mode: 0o600 });
  } catch {
    log('[status] write failed');
  }
}

async function notifyFallback({ primary, fallback, reason }) {
  const started = await metrics.beginFallback({ transport: fallback, reason });
  log(`[fallback] ${primary} unavailable before send; using ${fallback}; incident=${started.isNew ? 'new' : 'active'} reason=${reason}`);
  if (!metrics.shouldAttemptFallbackAlert()) return;
  void sendFallbackAlert({ primary, fallback, reason })
    .then(async (accepted) => {
      await metrics.markFallbackAlert(accepted);
      log(`[fallback] alert ${accepted ? 'accepted' : 'failed'}`);
    })
    .catch(async () => {
      await metrics.markFallbackAlert(false);
      log('[fallback] alert failed');
    });
}

async function performSend(phone, message, idempotencyKey) {
  return sendWithTransportFallback({
    primary: primaryTransport,
    fallback: fallbackTransport,
    phone,
    message,
    context: { idempotencyKey },
    log,
    hashPhone,
    onFallback: notifyFallback,
  });
}

const API_KEY = process.env.INTERNAL_API_SECRET || process.env.WHATSAPP_API_KEY || '';
const fastify = Fastify({ logger: false });

const rateLimitStore = new Map();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_GLOBAL_MAX = parseInt(process.env.RATE_LIMIT_GLOBAL_MAX || '60', 10);
let globalWindow = { count: 0, windowStart: 0 };

function rateLimitByIp(ip) {
  const now = Date.now();
  if (now - globalWindow.windowStart >= RATE_LIMIT_WINDOW_MS) {
    globalWindow = { count: 0, windowStart: now };
  }
  globalWindow.count += 1;
  if (globalWindow.count > RATE_LIMIT_GLOBAL_MAX) return false;
  let entry = rateLimitStore.get(ip);
  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    rateLimitStore.set(ip, entry);
  }
  entry.count += 1;
  if (rateLimitStore.size > 1000) {
    for (const [key, value] of rateLimitStore) {
      if (now - value.windowStart >= RATE_LIMIT_WINDOW_MS) rateLimitStore.delete(key);
    }
  }
  return entry.count <= RATE_LIMIT_MAX;
}

async function requireAuth(request, reply) {
  if (!API_KEY) return reply.code(503).send({ error: 'Service not configured' });
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  const token = authHeader.slice(7);
  const received = Buffer.from(token);
  const expected = Buffer.from(API_KEY);
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    return reply.code(403).send({ error: 'Forbidden' });
  }
}

function requestedTransport(request) {
  return normalizeTransportName(request.body?.transport, primaryName);
}

fastify.get('/health', async () => ({
  status: 'ok',
  primaryTransport: primaryName,
  fallbackEnabled: Boolean(fallbackName),
}));

fastify.get('/api/whatsapp/status', { onRequest: requireAuth }, async (_request, reply) => {
  await refreshStatuses();
  return reply.send(buildStatusResponse());
});

fastify.post('/api/whatsapp/qr', { onRequest: requireAuth }, async (request, reply) => {
  const name = requestedTransport(request);
  const transport = transportMap[name];
  if (!transport) return reply.code(400).send({ error: 'Invalid transport' });
  try {
    const qr = await transport.obterQR();
    if (!qr) return reply.code(409).send({ error: 'Transport already authenticated' });
    log(`[qr] generated for ${name}`);
    return reply.send({ ...qr, transport: name });
  } catch (err) {
    const code = err?.safeCode || `${name}_qr_failed`;
    log(`[qr] ${name} failed: ${code}`);
    return reply.code(code.includes('timeout') ? 504 : 503).send({ error: 'QR generation failed' });
  }
});

fastify.post('/api/whatsapp/send', { onRequest: requireAuth }, async (request, reply) => {
  const clientIp = request.ip || request.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (!rateLimitByIp(clientIp)) {
    log(`[send] rate limited ip=${hashValue(clientIp)}`);
    return reply.code(429).send({ error: 'Too many requests' });
  }

  const { to, message, idempotencyKey } = request.body || {};
  if (!to || !message) return reply.code(400).send({ error: 'Missing to or message' });

  if (idempotencyKey) {
    const result = await idemp.run(idempotencyKey, () => performSend(to, message, idempotencyKey));
    if (result.status === 'duplicate') {
      log(`[send] duplicate suppressed key=${idempotencyKey} (msgId: ${result.messageId})`);
      return reply.send({ success: true, messageId: result.messageId, duplicate: true });
    }
    if (result.status === 'contention') {
      log(`[send] contention key=${idempotencyKey}`);
      return reply.code(503).send({ error: 'Send contention, retry later' });
    }
    if (result.status === 'failed') {
      log(`[send] error key=${idempotencyKey}: ${result.error}`);
      return reply.code(500).send({ error: 'Failed to send message' });
    }
    await metrics.recordSend({ transport: result.transport || primaryName, fallback: result.fallback });
    log(`[send] success key=${idempotencyKey}: ${hashPhone(to)} transport=${result.transport || primaryName} fallback=${result.fallback === true} (msgId: ${result.messageId})`);
    return reply.send({ success: true, messageId: result.messageId });
  }

  const result = await performSend(to, message, null);
  if (!result.success) {
    log(`[send] error key=- transport=${result.transport}: ${result.error}`);
    return reply.code(500).send({ error: 'Failed to send message' });
  }
  const messageId = result.messageId || `vps-${Date.now()}`;
  await metrics.recordSend({ transport: result.transport, fallback: result.fallback });
  log(`[send] success key=-: ${hashPhone(to)} transport=${result.transport} fallback=${result.fallback === true} (msgId: ${messageId})`);
  return reply.send({ success: true, messageId });
});

fastify.post('/api/whatsapp/disconnect', { onRequest: requireAuth }, async (request, reply) => {
  const name = requestedTransport(request);
  const transport = transportMap[name];
  if (!transport) return reply.code(400).send({ error: 'Invalid transport' });
  log(`[disconnect] requested transport=${name}`);
  const result = await transport.desconectar();
  if (!result.ok) {
    log(`[disconnect] ${name} failed: ${result.error || `${name}_disconnect_failed`}`);
    return reply.code(503).send({ error: 'Failed to disconnect' });
  }
  await refreshStatuses();
  return reply.send({ success: true, transport: name });
});

async function start() {
  try {
    metrics.load(primaryName);
    await metrics.configure(primaryName);
    await seedMetricsFromLegacyStore();
    await Promise.all(Object.values(transportMap).map((transport) => transport.start()));

    const port = parseInt(process.env.PORT || '3457', 10);
    const host = process.env.BIND_HOST || '127.0.0.1';
    await fastify.listen({ port, host });
    log(`WhatsApp API server running on ${host}:${port} primary=${primaryName} fallback=${fallbackName || 'disabled'}`);
    await refreshStatuses();
    statusRefreshTimer = setInterval(() => {
      refreshStatuses().catch(() => log('[status] refresh cycle failed'));
    }, STATUS_REFRESH_MS);
  } catch (err) {
    if (err?.code === 'EADDRINUSE') {
      log(`FATAL: Port ${process.env.PORT || 3457} already in use`);
      process.exit(0);
    }
    log(`Server startup failed: ${err?.code || 'unknown_error'}`);
    process.exit(1);
  }
}

async function shutdown() {
  if (statusRefreshTimer) clearInterval(statusRefreshTimer);
  await Promise.all(Object.values(transportMap).map((transport) => transport.shutdown().catch(() => {})));
}

process.on('SIGINT', () => { shutdown().finally(() => process.exit(0)); });
process.on('SIGTERM', () => { shutdown().finally(() => process.exit(0)); });

start();
