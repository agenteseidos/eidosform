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
  const defaultAlternate = alternateBrazilianPhone(cleaned);
  const candidates = transport.phoneCandidates
    ? transport.phoneCandidates(cleaned)
    : [cleaned, defaultAlternate].filter(Boolean);
  const [firstPhone, alternate] = [...new Set(candidates)];
  const first = await transport.enviarTexto(firstPhone, message, context);
  if (first.success) return first;

  // A troca 8↔9 só é segura quando o transporte provou que rejeitou o
  // destinatário antes do envio. Timeout/5xx nunca tenta uma segunda variante.
  if (first.errorClass !== ERROR_CLASS.PERMANENTE || first.retryAlternateNumber !== true) {
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
  normalizeTransportName,
  sendWithNumberFallback,
  sendWithTransportFallback,
};
