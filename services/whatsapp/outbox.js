'use strict';

/**
 * FILA DE REENVIO — a lacuna que custou 14 leads do RCGT0826 em 2026-07-27.
 *
 * Até aqui, envio que falhava era DESCARTADO. Não havia fila, nem no serviço
 * nem no app: o handler devolvia 502 e a notificação morria ali. Entre 00:34 e
 * 09:24 daquele dia o transporte esteve quebrado; quando voltou às 11:40,
 * ninguém reenviou nada. As respostas continuaram no banco — o que se perdeu
 * foi o Sidney FICAR SABENDO, e com isso o tempo de resposta ao lead.
 *
 * Com esta fila, o mesmo incidente vira atraso em vez de perda.
 *
 * Decisões:
 * - PERMANENTE não entra na fila (destinatário inválido não melhora com tempo);
 *   vai direto pra carta morta, que alerta.
 * - PRE_FLIGHT e IN_FLIGHT entram. IN_FLIGHT *pode* ter entregue, então existe
 *   risco de duplicata no reenvio — aceito conscientemente: notificação
 *   repetida incomoda, lead perdido custa dinheiro. O wuzapi ainda protege
 *   sozinho, porque manda `Id` derivado da chave de idempotência e o aparelho
 *   do destinatário deduplica mensagem com mesmo ID.
 * - A fila é chaveada pela chave de idempotência e `enqueue` é IDEMPOTENTE.
 *   É isso que mata o martelo do cron de abandonado, que no incidente
 *   retentou o MESMO lead 35 vezes contra um transporte quebrado.
 */

const fsp = require('fs/promises');
const fs = require('fs');

// 1min, 2, 5, 10, 15, 30, e 60 daí em diante. Com 24 tentativas cobre ~20h,
// bem mais que as ~9h do pior incidente observado.
const BACKOFF_STEPS_MS = [60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000];
const DEFAULT_BACKOFF_MS = 3_600_000;
const DEFAULT_MAX_ATTEMPTS = 24;
const DEFAULT_MAX_ITEMS = 500;

function backoffFor(attempts) {
  return BACKOFF_STEPS_MS[attempts - 1] ?? DEFAULT_BACKOFF_MS;
}

function createOutbox({
  file = null,
  now = () => Date.now(),
  log = () => {},
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  maxItems = DEFAULT_MAX_ITEMS,
} = {}) {
  /** key -> { to, message, attempts, nextAttemptAt, firstFailedAt, lastError } */
  const pending = new Map();
  /** itens que esgotaram as tentativas — ficam para o alerta e para auditoria */
  let dead = [];
  let saveQueue = Promise.resolve();

  function load() {
    if (!file) return;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const [key, value] of Object.entries(raw.pending || {})) pending.set(key, value);
      dead = Array.isArray(raw.dead) ? raw.dead : [];
    } catch (err) {
      if (err.code !== 'ENOENT') {
        log('[outbox] arquivo ilegível — começando vazio');
        try { fs.renameSync(file, `${file}.corrupt`); } catch { /* melhor esforço */ }
      }
    }
  }

  function save() {
    if (!file) return Promise.resolve();
    // Serializa ANTES de entrar na fila: o estado pode mudar enquanto o
    // write anterior ainda está no ar.
    const snapshot = JSON.stringify({ pending: Object.fromEntries(pending), dead });
    saveQueue = saveQueue.then(async () => {
      const tmp = `${file}.tmp`;
      await fsp.writeFile(tmp, snapshot, { mode: 0o600 });
      await fsp.rename(tmp, file);
    }).catch(() => log('[outbox] falha ao persistir a fila'));
    return saveQueue;
  }

  function has(key) {
    return pending.has(key);
  }

  /** @returns {'enqueued'|'already_queued'|'rejected'|'full'} */
  async function enqueue({ key, to, message, error }) {
    if (!key || !to || !message) return 'rejected';
    // IDEMPOTENTE de propósito: o cron pode pedir o mesmo lead a cada 15 min.
    if (pending.has(key)) return 'already_queued';
    if (pending.size >= maxItems) {
      log('[outbox] fila cheia — item descartado');
      return 'full';
    }
    pending.set(key, {
      to,
      message,
      attempts: 0,
      nextAttemptAt: now() + backoffFor(1),
      firstFailedAt: now(),
      lastError: String(error || 'send_failed'),
    });
    await save();
    return 'enqueued';
  }

  function due() {
    const t = now();
    return [...pending.entries()]
      .filter(([, item]) => item.nextAttemptAt <= t)
      .map(([key, item]) => ({ key, to: item.to, message: item.message, attempts: item.attempts }));
  }

  /** @returns {'delivered'|'retry'|'dead'|'unknown'} */
  async function settle(key, { success, error }) {
    const item = pending.get(key);
    if (!item) return 'unknown';
    if (success) {
      pending.delete(key);
      await save();
      return 'delivered';
    }
    item.attempts += 1;
    item.lastError = String(error || 'send_failed');
    if (item.attempts >= maxAttempts) {
      pending.delete(key);
      dead.push({ key, to: item.to, firstFailedAt: item.firstFailedAt, diedAt: now(), lastError: item.lastError });
      // A carta morta é evidência de incidente, não log eterno.
      if (dead.length > 100) dead = dead.slice(-100);
      await save();
      return 'dead';
    }
    item.nextAttemptAt = now() + backoffFor(item.attempts + 1);
    await save();
    return 'retry';
  }

  /** Item que nunca deveria ser retentado (destinatário inválido, payload ruim). */
  async function killNow({ key, to, error }) {
    pending.delete(key);
    dead.push({ key, to, firstFailedAt: now(), diedAt: now(), lastError: String(error || 'permanent') });
    if (dead.length > 100) dead = dead.slice(-100);
    await save();
  }

  function snapshot() {
    let oldestFailedAt = null;
    for (const item of pending.values()) {
      if (oldestFailedAt === null || item.firstFailedAt < oldestFailedAt) oldestFailedAt = item.firstFailedAt;
    }
    return {
      pending: pending.size,
      dead: dead.length,
      oldestFailedAt: oldestFailedAt ? new Date(oldestFailedAt).toISOString() : null,
    };
  }

  /**
   * Devolve as cartas mortas ainda não alertadas e marca como alertadas.
   * NÃO apaga: a carta morta é a prova de que um lead não foi avisado, e essa
   * evidência precisa sobreviver ao e-mail.
   */
  async function takeUnalertedDead() {
    const novos = dead.filter((item) => !item.alerted);
    if (novos.length === 0) return [];
    for (const item of novos) item.alerted = true;
    await save();
    return novos;
  }

  return {
    load, save, has, enqueue, due, settle, killNow, snapshot, takeUnalertedDead,
    _pending: pending,
    _dead: () => dead,
  };
}

module.exports = { createOutbox, backoffFor, DEFAULT_MAX_ATTEMPTS };
