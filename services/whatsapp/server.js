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
const { createOutbox } = require('./outbox');
const {
  sendFallbackAlert,
  sendSendFailureAlert,
  sendDeadLetterAlert,
  sendVolumeAlert,
} = require('./ops-alert');
const { ERROR_CLASS } = require('./transport');

const LOG_FILE = path.join(__dirname, 'server.log');
const STATUS_FILE = path.join(__dirname, 'status.json');
const IDEMP_FILE = path.join(__dirname, 'sent-keys.json');
const METRICS_FILE = path.join(__dirname, 'transport-metrics.json');
const OUTBOX_FILE = path.join(__dirname, 'outbox.json');
const IDEMP_TTL_MS = 96 * 3600 * 1000;
const MAX_IDEMP_ACQUIRE_ATTEMPTS = 5;
const STATUS_REFRESH_MS = 5_000;
const OUTBOX_TICK_MS = 30_000;
const FAILURE_ALERT_THRESHOLD = 3;

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

const outbox = createOutbox({
  file: OUTBOX_FILE,
  log: (message) => log(message),
});
outbox.load();

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
let outboxTimer = null;
let outboxDraining = false;
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
    failures: snapshot.failures,
    outbox: outbox.snapshot(),
    sendsByTransport: snapshot.sendsByTransport,
    // Histórico dia a dia para o painel filtrar por período sem ida extra ao
    // servidor. São ~120 dias de contadores pequenos.
    daily: metrics.dailyHistory(),
    // A partir de quando existe atribuição por motor. Antes disto os dias só
    // têm `legacy`, e o painel precisa dizer isso em vez de fingir cobertura.
    transportAttributionSince: snapshot.initializedAt,
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

/**
 * Alarme do que REALMENTE importa: o envio funcionando.
 * O healthcheck vigia se a sessão está autenticada — e em 27/07/2026
 * `authenticated=true` ficou verdadeiro por 9 horas enquanto todo envio
 * falhava. Sessão viva não é envio funcionando.
 */
async function notifyFailure({ transport, error }) {
  const consecutive = await metrics.recordFailure({ transport, error });
  if (!metrics.shouldAttemptFailureAlert({ threshold: FAILURE_ALERT_THRESHOLD })) return;
  const queued = outbox.snapshot().pending;
  void sendSendFailureAlert({ consecutive, transport: transport || primaryName, error, queued })
    .then(async (accepted) => {
      await metrics.markFailureAlert(accepted);
      log(`[falha] alerta ${accepted ? 'aceito' : 'nao enviado'} consecutivas=${consecutive}`);
    })
    .catch(async () => {
      await metrics.markFailureAlert(false);
      log('[falha] alerta nao enviado');
    });
}

async function maybeAlertVolume() {
  if (!metrics.shouldAlertVolume()) return;
  const { volume } = metrics.snapshot();
  // Marca ANTES de mandar: alerta de volume é aviso, e um aviso que se repete
  // por corrida vira ruído. No máximo um por dia, mesmo se o e-mail falhar.
  await metrics.markVolumeAlert();
  void sendVolumeAlert({ today: volume.today, average7Days: volume.average7Days })
    .then((ok) => log(`[volume] alerta ${ok ? 'aceito' : 'nao enviado'} hoje=${volume.today} media=${volume.average7Days}`))
    .catch(() => log('[volume] alerta nao enviado'));
}

async function reportDeadLetters() {
  const mortos = await outbox.takeUnalertedDead();
  if (mortos.length === 0) return;
  const oldest = mortos.map((item) => item.firstFailedAt).sort((a, b) => a - b)[0];
  void sendDeadLetterAlert({
    count: mortos.length,
    oldest: oldest ? new Date(oldest).toISOString() : null,
  })
    .then((ok) => log(`[outbox] alerta de carta morta ${ok ? 'aceito' : 'nao enviado'} n=${mortos.length}`))
    .catch(() => log('[outbox] alerta de carta morta nao enviado'));
}

/**
 * Drena a fila de reenvio. Serial de propósito: são notificações para a MESMA
 * pessoa e não há ganho em paralelizar, só risco de rajada num transporte que
 * acabou de voltar do chão.
 */
async function drainOutbox() {
  const itens = outbox.due();
  if (itens.length === 0) return;
  log(`[outbox] ${itens.length} pendente(s) para reenviar`);
  for (const item of itens) {
    const result = await performSend(item.to, item.message, item.key);
    if (result.success) {
      await outbox.settle(item.key, { success: true });
      // Sem isto, o cron de abandonado repetiria a notificação 15 min depois.
      await idemp.remember(item.key, result.messageId, {
        transport: result.transport,
        fallback: result.fallback,
      });
      await metrics.recordSend({ transport: result.transport || primaryName, fallback: result.fallback });
      log(`[outbox] REENTREGUE key=${item.key} transport=${result.transport} tentativa=${item.attempts + 1}`);
      continue;
    }
    // Bloqueio operacional é DECISÃO, não falha: morre em silêncio, sem contar
    // pro alarme de carta morta (na prática não deveria chegar aqui — o kill
    // já acontece na 1ª tentativa, antes de entrar na fila — mas cobre o caso
    // de um item ter sido enfileirado ANTES do destino entrar no bloqueio).
    if (result.errorClass === ERROR_CLASS.BLOQUEADO) {
      await outbox.killNow({ key: item.key, to: item.to, error: result.error, silent: true });
      log(`[outbox] descartado em silencio (bloqueio operacional) key=${item.key}`);
      continue;
    }
    if (result.errorClass === ERROR_CLASS.PERMANENTE) {
      await outbox.killNow({ key: item.key, to: item.to, error: result.error });
      log(`[outbox] descartado por erro permanente key=${item.key}: ${result.error}`);
      continue;
    }
    const veredito = await outbox.settle(item.key, { success: false, error: result.error });
    log(`[outbox] key=${item.key} -> ${veredito} tentativa=${item.attempts + 1} erro=${result.error}`);
  }
  await reportDeadLetters();
}

/**
 * Decide o destino de um envio que falhou. Só PERMANENTE morre na hora:
 * destinatário inválido não melhora esperando.
 *
 * BLOQUEADO é tratado ANTES de tudo, de propósito: é uma DECISÃO nossa (não
 * enviar para este número), não uma falha do transporte. Por isso NÃO conta
 * pro `notifyFailure` (alarme de falhas consecutivas) e morre em silêncio —
 * sem o e-mail de carta morta, que soaria a cada 15 min enquanto o bloqueio
 * durar (era exatamente o ruído que o caso Karin deixou, 31/07).
 */
async function handleFailedSend({ key, to, message, result }) {
  if (result.errorClass === ERROR_CLASS.BLOQUEADO) {
    if (key) await outbox.killNow({ key, to, error: result.error, silent: true });
    return { queued: false, blocked: true };
  }
  await notifyFailure({ transport: result.transport, error: result.error });
  if (!key) return { queued: false };
  if (result.errorClass === ERROR_CLASS.PERMANENTE) {
    await outbox.killNow({ key, to, error: result.error });
    await reportDeadLetters();
    return { queued: false };
  }
  const veredito = await outbox.enqueue({ key, to, message, error: result.error });
  return { queued: veredito === 'enqueued' || veredito === 'already_queued', veredito };
}

/**
 * NUNCA ENVIAR — bloqueio operacional por destinatário (30/07/2026).
 *
 * Descoberta medida em produção, 4 de 4: TODO envio para o número da Karin
 * partindo de aparelho VINCULADO derruba o aparelho remetente no MESMO segundo
 * (wuzapi 2× via 463+401; wacli 2× deslogado ~1s após o envio, sem nem dar
 * erro). Do celular (aparelho principal) chega normal. Causa raiz desconhecida
 * — provável incompatibilidade dos clientes whatsmeow com algo do contato dela.
 *
 * Enquanto a causa não é resolvida, enviar para esse número = derrubar TODAS as
 * notificações até alguém reparear QR. O bloqueio devolve BLOQUEADO (31/07:
 * ANTES devolvia PERMANENTE, e cada tentativa virava carta morta + e-mail de
 * alerta — com o cron de abandono reclamando o mesmo lead a cada 15 min,
 * disparava um e-mail por rodada, indefinidamente, enquanto o número
 * permanecesse na lista). Agora morre em silêncio: sem alarme, sem contar pro
 * alarme de falhas consecutivas. O chamador (EidosForm) decide como repassar.
 */
const NUNCA_ENVIAR = new Set(
  (process.env.WHATSAPP_NUNCA_ENVIAR || '')
    .split(',')
    .map((n) => n.replace(/\D/g, ''))
    .filter(Boolean)
    .flatMap((n) => require('./transport').brazilianPhoneCandidates(n)),
);

function destinoBloqueado(phone) {
  const cleaned = String(phone || '').replace(/\D/g, '');
  return require('./transport')
    .brazilianPhoneCandidates(cleaned)
    .some((v) => NUNCA_ENVIAR.has(v));
}

async function performSend(phone, message, idempotencyKey) {
  if (destinoBloqueado(phone)) {
    log(`[send] BLOQUEADO por WHATSAPP_NUNCA_ENVIAR: ${hashPhone(phone)} — repassar manualmente`);
    return {
      success: false,
      error: 'destino_bloqueado_operacionalmente',
      errorClass: ERROR_CLASS.BLOQUEADO,
      transport: 'nenhum',
    };
  }
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
    // Já está na fila de reenvio? Então NÃO tenta de novo agora. É isto que
    // impede o cron de lead abandonado de martelar um transporte quebrado a
    // cada 15 min — em 27/07 foram 35 tentativas para o MESMO lead.
    if (outbox.has(idempotencyKey)) {
      log(`[send] ja esta na fila de reenvio key=${idempotencyKey}`);
      return reply.code(202).send({ success: false, queued: true, error: 'Queued for retry' });
    }

    const result = await idemp.run(idempotencyKey, () => performSend(to, message, idempotencyKey));
    if (result.status === 'duplicate') {
      log(`[send] duplicate suppressed key=${idempotencyKey} (msgId: ${result.messageId})`);
      return reply.send({ success: true, messageId: result.messageId, duplicate: true, transport: result.transport || null });
    }
    if (result.status === 'contention') {
      log(`[send] contention key=${idempotencyKey}`);
      return reply.code(503).send({ error: 'Send contention, retry later' });
    }
    if (result.status === 'failed') {
      const bruto = result.raw || { error: result.error };
      const destino = await handleFailedSend({ key: idempotencyKey, to, message, result: bruto });
      log(`[send] falhou key=${idempotencyKey}: ${result.error} fila=${destino.queued} bloqueado=${Boolean(destino.blocked)}`);
      if (destino.blocked) {
        // 200 (NÃO 500): não é erro, é uma DECISÃO nossa de não enviar. Um
        // 500 faria o chamador (cron) tratar como falha de transporte e
        // reclamar o lead de novo na próxima rodada — o mesmo ruído a cada
        // 15 min que o bloqueio da Karin deixou em 31/07.
        return reply.send({ success: false, blocked: true, error: result.error });
      }
      if (destino.queued) {
        // 202: NÃO foi entregue, mas também NÃO foi perdida. É a diferença
        // entre este incidente e o de 27/07, quando a notificação sumia aqui.
        return reply.code(202).send({ success: false, queued: true, error: 'Queued for retry' });
      }
      return reply.code(500).send({ error: 'Failed to send message' });
    }
    await metrics.recordSend({ transport: result.transport || primaryName, fallback: result.fallback });
    await maybeAlertVolume();
    log(`[send] success key=${idempotencyKey}: ${hashPhone(to)} transport=${result.transport || primaryName} fallback=${result.fallback === true} (msgId: ${result.messageId})`);
    return reply.send({ success: true, messageId: result.messageId, transport: result.transport || primaryName });
  }

  const result = await performSend(to, message, null);
  if (!result.success) {
    if (result.errorClass === ERROR_CLASS.BLOQUEADO) {
      log(`[send] bloqueado key=- : ${result.error}`);
      return reply.send({ success: false, blocked: true, error: result.error });
    }
    // Sem chave de idempotência não há como deduplicar um reenvio, então este
    // caminho não entra na fila — mas o alarme de falha vale igual.
    await notifyFailure({ transport: result.transport, error: result.error });
    log(`[send] falhou key=- transport=${result.transport}: ${result.error}`);
    return reply.code(500).send({ error: 'Failed to send message' });
  }
  const messageId = result.messageId || `vps-${Date.now()}`;
  await metrics.recordSend({ transport: result.transport, fallback: result.fallback });
  await maybeAlertVolume();
  log(`[send] success key=-: ${hashPhone(to)} transport=${result.transport} fallback=${result.fallback === true} (msgId: ${messageId})`);
  return reply.send({ success: true, messageId, transport: result.transport || primaryName });
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

    const pendentes = outbox.snapshot().pending;
    if (pendentes > 0) log(`[outbox] ${pendentes} notificacao(oes) esperando reenvio desde antes do restart`);
    outboxTimer = setInterval(() => {
      if (outboxDraining) return; // uma drenagem por vez: reenvio não pode empilhar
      outboxDraining = true;
      drainOutbox()
        .catch(() => log('[outbox] ciclo de reenvio falhou'))
        .finally(() => { outboxDraining = false; });
    }, OUTBOX_TICK_MS);
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
  if (outboxTimer) clearInterval(outboxTimer);
  await Promise.all(Object.values(transportMap).map((transport) => transport.shutdown().catch(() => {})));
}

process.on('SIGINT', () => { shutdown().finally(() => process.exit(0)); });
process.on('SIGTERM', () => { shutdown().finally(() => process.exit(0)); });

start();
