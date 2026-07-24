'use strict';

/**
 * Idempotência de envio — EXTRAÍDA do server.js para poder ser TESTADA.
 *
 * Motivo (2ª auditoria Codex, P1-8 + P2-9): a coalescência de envios concorrentes
 * é lógica de CONCORRÊNCIA — o tipo de código que quebra em silêncio e só aparece
 * como "cliente recebeu a mensagem 3 vezes". Ela vivia dentro de um handler do
 * fastify em server.js, arquivo que a suíte não cobria: 565 testes verdes não
 * protegiam NADA disto. Aqui vira um módulo puro (sem fastify, sem wacli), com
 * relógio e disco injetáveis.
 *
 * Contrato: `run(key, send)` executa `send` NO MÁXIMO UMA VEZ por chave viva.
 * Chamadas simultâneas com a mesma chave esperam a primeira e reaproveitam o
 * resultado. Se a primeira FALHAR, a chave é liberada e UMA das que esperavam
 * vira a nova titular (as outras esperam essa) — nunca todas de uma vez, que era
 * exatamente o bug P1-8.
 */

const fsp = require('fs/promises');
const fs = require('fs');

const DEFAULT_TTL_MS = 96 * 3600 * 1000; // > janela de abandono (72h) + margem
const DEFAULT_MAX_ACQUIRE_ATTEMPTS = 5;
const DEFAULT_MAX_ENTRIES = 5000;

/**
 * @param {object} opts
 * @param {string|null} opts.file      caminho do JSON persistido (null = só memória)
 * @param {number} opts.ttlMs
 * @param {number} opts.maxAcquireAttempts
 * @param {number} opts.maxEntries
 * @param {() => number} opts.now      relógio injetável (testes de TTL)
 * @param {(msg: string) => void} opts.log
 * @param {(err: unknown) => string} opts.sanitizeError  NUNCA devolver texto cru
 *        de processo (P1-5: `err.message` do execFile carrega telefone e mensagem)
 */
function createIdempotencyStore(opts = {}) {
  const file = opts.file ?? null;
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const maxAcquireAttempts = opts.maxAcquireAttempts ?? DEFAULT_MAX_ACQUIRE_ATTEMPTS;
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const now = opts.now ?? (() => Date.now());
  const log = opts.log ?? (() => {});
  const sanitizeError = opts.sanitizeError ?? (() => 'send_failed');

  /** key -> { ts, messageId? , promise? }  (promise presente = envio em voo) */
  const map = new Map();

  /** Carrega o disco. JSON corrompido é preservado como .corrupt e começa vazio. */
  function load() {
    if (!file) return;
    try {
      const raw = fs.readFileSync(file, 'utf8');
      for (const [k, v] of Object.entries(JSON.parse(raw))) map.set(k, v);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        log(`[idemp] arquivo ilegível (${err.message}) — movendo pra .corrupt`);
        try { fs.renameSync(file, file + '.corrupt'); } catch { /* melhor esforço */ }
      }
    }
  }

  function prune() {
    const t = now();
    for (const [k, v] of map) {
      // Entrada EM VOO nunca é podada: ela ainda não tem messageId e podá-la
      // liberaria a chave pra um envio paralelo.
      if (v && v.promise) continue;
      if (!v || !v.ts || t - v.ts > ttlMs) map.delete(k);
    }
    while (map.size > maxEntries) map.delete(map.keys().next().value);
  }

  function get(key) {
    const v = map.get(key);
    if (v && !v.promise && v.ts && now() - v.ts > ttlMs) { map.delete(key); return undefined; }
    return v;
  }

  /** Atômico (tmp+rename) e AWAITED — escrita interrompida corrompia o JSON. */
  async function save() {
    if (!file) return;
    prune();
    const serializavel = {};
    for (const [k, v] of map) if (v && v.messageId) serializavel[k] = { ts: v.ts, messageId: v.messageId };
    const tmp = file + '.tmp';
    try {
      await fsp.writeFile(tmp, JSON.stringify(serializavel), { mode: 0o600 });
      await fsp.rename(tmp, file);
    } catch (err) {
      log(`[idemp] ERRO ao persistir sent-keys: ${err.message}`);
    }
  }

  /**
   * @param {string} key
   * @param {() => Promise<{success: boolean, messageId?: string, error?: unknown}>} send
   * @returns {Promise<{status:'sent'|'duplicate'|'contention'|'failed', messageId?: string, error?: string}>}
   */
  async function run(key, send) {
    let entry = null;

    // AQUISIÇÃO EM LOOP (P1-8). A regra de ouro: depois de QUALQUER `await` é
    // obrigatório reconsultar o mapa. Só instala reserva quem chegar até o
    // `map.set` sem nenhum await no caminho — aí é atômico no event loop do Node.
    for (let attempt = 0; attempt < maxAcquireAttempts; attempt++) {
      const prev = get(key);

      if (prev && prev.messageId) {
        return { status: 'duplicate', messageId: prev.messageId };
      }

      if (prev && prev.promise) {
        const r = await prev.promise; // <-- await: o mapa pode ter mudado
        if (r && r.success) {
          return { status: 'duplicate', messageId: r.messageId || 'vps-coalesced' };
        }
        continue; // titular falhou: RECONSULTA em vez de instalar reserva cega
      }

      const fresh = { ts: now() };
      fresh.promise = Promise.resolve()
        .then(send)
        .then(async (r) => {
          if (r && r.success) {
            fresh.messageId = r.messageId || `vps-${now()}`;
            delete fresh.promise;
            await save();
          } else {
            map.delete(key); // falha libera a chave pro retry
          }
          return r;
        })
        .catch((err) => {
          map.delete(key);
          return { success: false, error: sanitizeError(err) };
        });
      map.set(key, fresh); // reserva ANTES de qualquer await
      entry = fresh;
      break;
    }

    if (!entry) {
      // Contenção alta: nem virei titular nem observei sucesso. Melhor devolver
      // "tente de novo" do que enfileirar mais um envio pro mesmo destinatário.
      return { status: 'contention' };
    }

    const result = await entry.promise;
    if (!result || !result.success) {
      return { status: 'failed', error: result && result.error ? String(result.error) : 'send_failed' };
    }
    return { status: 'sent', messageId: entry.messageId };
  }

  return { load, prune, get, save, run, size: () => map.size, _map: map };
}

module.exports = { createIdempotencyStore, DEFAULT_TTL_MS };
