'use strict';

const ERROR_CLASS = Object.freeze({
  PRE_FLIGHT: 'PRE_FLIGHT',
  IN_FLIGHT: 'IN_FLIGHT',
  PERMANENTE: 'PERMANENTE',
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

async function sendWithNumberFallback(transport, phone, message, context, { log, hashPhone }) {
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

  if (!alternate) return first;

  log(`[send] Trying Brazilian number fallback via ${transport.name}: ${hashPhone(alternate)}`);
  const second = await transport.enviarTexto(alternate, message, context);
  return second.success ? second : first;
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
}) {
  const primaryResult = await sendWithNumberFallback(primary, phone, message, context, { log, hashPhone });
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

  const fallbackResult = await sendWithNumberFallback(fallback, phone, message, context, { log, hashPhone });
  return {
    ...fallbackResult,
    transport: fallback.name,
    fallback: true,
    primaryError: primaryResult.error,
  };
}

module.exports = {
  ERROR_CLASS,
  SUPPORTED_TRANSPORTS,
  alternateBrazilianPhone,
  brazilianPhoneCandidates,
  formatBrazilianPhone,
  normalizeTransportName,
  sendWithNumberFallback,
  sendWithTransportFallback,
};
