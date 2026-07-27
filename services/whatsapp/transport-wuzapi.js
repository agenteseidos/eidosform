'use strict';

const crypto = require('crypto');
const { ERROR_CLASS } = require('./transport');

const DEFAULT_TIMEOUT_MS = 15_000;
const QR_TTL_MS = 45_000;

function safeMessageId(idempotencyKey) {
  if (!idempotencyKey) return undefined;
  return crypto.createHash('sha256').update(String(idempotencyKey)).digest('hex').slice(0, 32).toUpperCase();
}

function classifyFetchError(err) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return { error: 'wuzapi_timeout', errorClass: ERROR_CLASS.IN_FLIGHT };
  }
  const code = err?.cause?.code || err?.code;
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return { error: `wuzapi_unavailable_${String(code).toLowerCase()}`, errorClass: ERROR_CLASS.PRE_FLIGHT };
  }
  return { error: 'wuzapi_connection_interrupted', errorClass: ERROR_CLASS.IN_FLIGHT };
}

function classifyHttpFailure(status, payload) {
  const safeText = String(payload?.error || payload?.data?.Details || '').toLowerCase();
  if (status === 401 || status === 403) {
    return { error: 'wuzapi_auth_rejected', errorClass: ERROR_CLASS.PRE_FLIGHT };
  }
  if (status === 404) {
    return { error: 'wuzapi_endpoint_not_found', errorClass: ERROR_CLASS.PRE_FLIGHT };
  }
  if (status === 400 || status === 409 || status === 422) {
    return {
      error: safeText.includes('phone') || safeText.includes('jid')
        ? 'wuzapi_invalid_recipient'
        : 'wuzapi_invalid_payload',
      errorClass: ERROR_CLASS.PERMANENTE,
      retryAlternateNumber: safeText.includes('phone') || safeText.includes('jid'),
    };
  }
  if (status >= 500 && (
    safeText.includes('no session')
    || safeText.includes('not connected')
    || safeText.includes('not logged')
  )) {
    return { error: 'wuzapi_session_unavailable', errorClass: ERROR_CLASS.PRE_FLIGHT };
  }
  if (status >= 500) {
    return { error: 'wuzapi_server_error_after_request', errorClass: ERROR_CLASS.IN_FLIGHT };
  }
  return { error: 'wuzapi_request_rejected', errorClass: ERROR_CLASS.PERMANENTE };
}

function phoneFromJid(jid) {
  const digits = String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
  return digits || null;
}

function createWuzapiTransport({
  url = process.env.WUZAPI_URL || 'http://127.0.0.1:8080',
  token = process.env.WUZAPI_TOKEN || '',
  fetchFn = global.fetch,
  now = () => Date.now(),
} = {}) {
  const baseUrl = String(url).replace(/\/+$/, '');

  async function request(path, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    try {
      const response = await fetchFn(`${baseUrl}${path}`, {
        ...options,
        headers: {
          Token: token,
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const payload = await response.json().catch(() => null);
      return { response, payload };
    } catch (err) {
      return { failure: classifyFetchError(err) };
    }
  }

  async function obterStatus() {
    if (!token) {
      return {
        authenticated: false,
        connected: false,
        phone: null,
        available: false,
        error: 'wuzapi_token_missing',
      };
    }
    const { response, payload, failure } = await request('/session/status', { method: 'GET' }, 8_000);
    if (failure) {
      return { authenticated: false, connected: false, phone: null, available: false, error: failure.error };
    }
    if (!response.ok || payload?.success !== true) {
      const classified = classifyHttpFailure(response.status, payload);
      return { authenticated: false, connected: false, phone: null, available: true, error: classified.error };
    }
    const data = payload.data || {};
    return {
      authenticated: data.loggedIn === true || data.LoggedIn === true,
      connected: data.connected === true || data.Connected === true,
      phone: phoneFromJid(data.jid),
      available: true,
      error: null,
    };
  }

  async function enviarTexto(phone, message, context = {}) {
    const status = await obterStatus();
    if (!status.available) {
      return { success: false, error: status.error || 'wuzapi_unavailable', errorClass: ERROR_CLASS.PRE_FLIGHT };
    }
    if (!status.authenticated || !status.connected) {
      return { success: false, error: 'wuzapi_session_not_ready', errorClass: ERROR_CLASS.PRE_FLIGHT };
    }

    const cleanMessage = String(message).replace(/\r\n?/g, '\n').trim();
    const body = {
      Phone: String(phone).replace(/\D/g, ''),
      Body: cleanMessage,
    };
    const id = safeMessageId(context.idempotencyKey);
    if (id) body.Id = id;

    const { response, payload, failure } = await request('/chat/send/text', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (failure) return { success: false, ...failure };
    if (!response.ok || payload?.success !== true) {
      return { success: false, ...classifyHttpFailure(response.status, payload) };
    }

    const data = payload.data || {};
    const messageId = data.Id || data.id || null;
    const timestamp = data.Timestamp ?? data.timestamp;
    const details = String(data.Details || data.details || '').toLowerCase();
    // O WuzAPI só responde depois que whatsmeow.SendMessage retorna um ACK do
    // servidor. Não é recibo de entrega no aparelho; essa limitação fica
    // explícita no relatório.
    const accepted = details === 'sent' && Boolean(messageId) && timestamp !== undefined && timestamp !== null;
    if (!accepted) {
      return {
        success: false,
        error: 'wuzapi_ambiguous_success_response',
        errorClass: ERROR_CLASS.IN_FLIGHT,
      };
    }
    return { success: true, messageId, error: null, errorClass: null };
  }

  async function obterQR() {
    let status = await obterStatus();
    if (status.authenticated) return null;
    if (!status.available) {
      const error = new Error(status.error || 'wuzapi_unavailable');
      error.safeCode = status.error || 'wuzapi_unavailable';
      throw error;
    }

    if (!status.connected) {
      const connect = await request('/session/connect', {
        method: 'POST',
        body: JSON.stringify({ Subscribe: [], Immediate: true }),
      }, 12_000);
      if (connect.failure) {
        const error = new Error(connect.failure.error);
        error.safeCode = connect.failure.error;
        throw error;
      }
      if (!connect.response.ok && connect.response.status !== 500) {
        const classified = classifyHttpFailure(connect.response.status, connect.payload);
        const error = new Error(classified.error);
        error.safeCode = classified.error;
        throw error;
      }
    }

    const deadline = now() + 8_000;
    while (now() < deadline) {
      const qrResult = await request('/session/qr', { method: 'GET' }, 5_000);
      if (qrResult.response?.ok && qrResult.payload?.success === true) {
        const value = qrResult.payload.data?.QRCode || '';
        const qr = String(value).replace(/^data:image\/png;base64,/, '');
        if (qr) {
          return { qr, format: 'png_base64', expiresAt: now() + QR_TTL_MS };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
      status = await obterStatus();
      if (status.authenticated) return null;
    }
    const error = new Error('wuzapi_qr_timeout');
    error.safeCode = 'wuzapi_qr_timeout';
    throw error;
  }

  async function desconectar() {
    const status = await obterStatus();
    const endpoint = status.authenticated ? '/session/logout' : '/session/disconnect';
    const { response, payload, failure } = await request(endpoint, { method: 'POST' }, 12_000);
    if (failure) return { ok: false, error: failure.error };
    if (!response.ok || payload?.success !== true) {
      return { ok: false, error: classifyHttpFailure(response.status, payload).error };
    }
    return { ok: true };
  }

  return {
    name: 'wuzapi',
    enviarTexto,
    obterStatus,
    obterQR,
    desconectar,
    start: async () => {},
    shutdown: async () => {},
  };
}

module.exports = {
  createWuzapiTransport,
  classifyFetchError,
  classifyHttpFailure,
  safeMessageId,
};
