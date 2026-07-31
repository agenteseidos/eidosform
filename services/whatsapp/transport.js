'use strict';

const ERROR_CLASS = Object.freeze({
  PRE_FLIGHT: 'PRE_FLIGHT',
  IN_FLIGHT: 'IN_FLIGHT',
  PERMANENTE: 'PERMANENTE',
  // Não enviamos de PROPÓSITO (WHATSAPP_NUNCA_ENVIAR). Diferente de PERMANENTE:
  // aquele é uma FALHA real (destinatário inválido) e deve virar alerta de
  // carta morta. Isto é uma DECISÃO nossa — não é falha, não conta pro alarme
  // de falhas consecutivas, e não deveria acordar ninguém a cada 15 min só
  // porque a decisão continua de pé (ver server.js `destinoBloqueado`).
  BLOQUEADO: 'BLOQUEADO',
});

const SUPPORTED_TRANSPORTS = new Set(['wacli', 'wuzapi']);

function normalizeTransportName(value, fallback = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return SUPPORTED_TRANSPORTS.has(normalized) ? normalized : fallback;
}

/**
 * A ORDEM aqui não é estilo, é a diferença entre a notificação chegar e sumir.
 *
 * Até 2026-07 todo envio de produção saía convertido para 12 dígitos — o
 * server.js antigo removia o 9 INCONDICIONALMENTE antes de chamar o wacli — e
 * é esse o JID real das contas neste DDD (confere com o jid gravado no banco de
 * sessão do whatsmeow). Enviar para a variante de 13 dígitos NÃO devolve erro:
 * o servidor dá ACK, `success` vira true, a chave de idempotência é gravada e a
 * mensagem some sem retry. Ou seja, a variante errada falha em SILÊNCIO e o
 * fallback de número nunca dispara, porque ele exige um erro PERMANENTE.
 *
 * Por isso a regra mora aqui e é o default de quem não declara `phoneCandidates`:
 * um motor novo não pode nascer com uma ordem diferente da que está provada.
 */
function brazilianPhoneCandidates(phone) {
  const cleaned = String(phone || '').replace(/\D/g, '');
  if (cleaned.length === 13 && cleaned.startsWith('55')) {
    return [`55${cleaned.substring(2, 4)}${cleaned.substring(5)}`, cleaned];
  }
  if (cleaned.length === 12 && cleaned.startsWith('55')) {
    return [cleaned, `55${cleaned.substring(2, 4)}9${cleaned.substring(4)}`];
  }
  return [cleaned];
}

/**
 * Formato ÚNICO de exibição. Os dois cards do painel existem para o operador
 * bater a olho que os motores estão na MESMA linha; se um mostra
 * "+55 83 9696-6457" e o outro "558396966457", a comparação deixa de ser óbvia.
 * Nunca vai para log — o painel é autenticado, o log usa hash.
 */
function formatBrazilianPhone(digits) {
  const cleaned = String(digits || '').replace(/\D/g, '');
  const match = cleaned.match(/^55(\d{10,11})$/);
  if (!match) return cleaned || null;
  return `+55 ${match[1].replace(/(\d{2})(\d{4,5})(\d{4})/, '$1 $2-$3')}`;
}

function alternateBrazilianPhone(phone) {
  const cleaned = String(phone || '').replace(/\D/g, '');
  if (cleaned.length === 13 && cleaned.startsWith('55')) {
    return `55${cleaned.substring(2, 4)}${cleaned.substring(5)}`;
  }
  if (cleaned.length === 12 && cleaned.startsWith('55')) {
    return `55${cleaned.substring(2, 4)}9${cleaned.substring(4)}`;
  }
  return null;
}

/** Espera curta o suficiente pro handshake assentar, curta demais pra atrasar lead. */
const COLD_SESSION_RETRY_MS = 2_000;

async function sendWithNumberFallback(
  transport,
  phone,
  message,
  context,
  { log, hashPhone, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), retryColdSessionMs = COLD_SESSION_RETRY_MS },
) {
  const cleaned = String(phone || '').replace(/\D/g, '');
  const candidates = transport.phoneCandidates
    ? transport.phoneCandidates(cleaned)
    : brazilianPhoneCandidates(cleaned);
  const [firstPhone, alternate] = [...new Set(candidates.filter(Boolean))];
  const first = await transport.enviarTexto(firstPhone, message, context);
  if (first.success) return first;

  // A troca 8↔9 só é segura quando o transporte provou que NADA foi entregue.
  // Quem carrega essa prova é a flag `retryAlternateNumber` — ela só é marcada
  // em rejeições explícitas do servidor, nunca em timeout/5xx ambíguo.
  //
  // ⚠️ Antes esta linha exigia TAMBÉM `errorClass === PERMANENTE`, e isso
  // acoplou duas decisões que não têm nada a ver uma com a outra: "posso tentar
  // o outro formato do número?" e "vale a pena tentar de novo mais tarde?".
  // O resultado foi 3 notificações descartadas em 29/07 (erro 463) — ver
  // classifyHttpFailure em transport-wuzapi.js.
  if (first.retryAlternateNumber !== true) {
    return first;
  }

  if (alternate) {
    log(`[send] Trying Brazilian number fallback via ${transport.name}: ${hashPhone(alternate)}`);
    const second = await transport.enviarTexto(alternate, message, context);
    if (second?.success) return second;
  }

  // ─── SEGUNDA CHANCE IMEDIATA (LINHA FRIA) ────────────────────────────────
  // O WhatsApp mantém uma linha de criptografia por APARELHO do destinatário.
  // Quem recebe pouco tem a linha sempre "fria" e ela precisa ser negociada na
  // hora do envio — e é justamente aí que sai o 463.
  //
  // O detalhe que resolve: **a tentativa que falha já negocia a linha**. Foi
  // medido em 29/07 — depois das 2 falhas com a Karin (`554792102898`, 4
  // aparelhos, ~1 notificação a cada 2 dias), as 4 sessões dela apareceram no
  // banco. A tentativa seguinte encontra o caminho pronto.
  //
  // Sem isto, o caminho é: falha → motor RESERVA (e-mail de alerta à toa) ou
  // fila de reenvio (notificação 1 min atrasada). Com isto, a mensagem chega em
  // ~2s pelo motor certo, sem alarme falso.
  //
  // Só roda quando o transporte PROVOU que nada saiu (`retryAlternateNumber`),
  // então reenviar aqui não pode duplicar.
  await sleep(retryColdSessionMs);
  log(`[send] 2a chance apos negociar sessao via ${transport.name}: ${hashPhone(firstPhone)}`);
  const terceira = await transport.enviarTexto(firstPhone, message, context);
  // `?.` de propósito: transporte que devolve vazio não pode derrubar o envio.
  if (terceira?.success) return terceira;

  return first;
}

async function sendWithTransportFallback({
  primary,
  fallback,
  phone,
  message,
  context = {},
  log,
  hashPhone,
  onFallback,
  sleep,
  retryColdSessionMs,
}) {
  const deps = { log, hashPhone, ...(sleep ? { sleep } : {}), ...(retryColdSessionMs !== undefined ? { retryColdSessionMs } : {}) };
  const primaryResult = await sendWithNumberFallback(primary, phone, message, context, deps);
  if (primaryResult.success) {
    return { ...primaryResult, transport: primary.name, fallback: false };
  }

  if (!fallback || primaryResult.errorClass !== ERROR_CLASS.PRE_FLIGHT) {
    return { ...primaryResult, transport: primary.name, fallback: false };
  }

  // Nunca há chamadas paralelas: o reserva só começa após uma falha PRE_FLIGHT
  // conclusiva do primário.
  if (onFallback) {
    await onFallback({
      primary: primary.name,
      fallback: fallback.name,
      reason: primaryResult.error || 'primary_pre_flight_failure',
    });
  }

  const fallbackResult = await sendWithNumberFallback(fallback, phone, message, context, deps);
  return {
    ...fallbackResult,
    transport: fallback.name,
    fallback: true,
    primaryError: primaryResult.error,
  };
}

module.exports = {
  COLD_SESSION_RETRY_MS,
  ERROR_CLASS,
  SUPPORTED_TRANSPORTS,
  alternateBrazilianPhone,
  brazilianPhoneCandidates,
  formatBrazilianPhone,
  normalizeTransportName,
  sendWithNumberFallback,
  sendWithTransportFallback,
};
