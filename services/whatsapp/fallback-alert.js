'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const DEFAULT_ENV_FILE = '/home/sidney/eidosform/.env.production.local';
const FROM = 'EidosForm Monitor <noreply@eidosform.com.br>';

function loadAlertConfig(envFile = DEFAULT_ENV_FILE) {
  try {
    const values = dotenv.parse(fs.readFileSync(envFile));
    const recipients = [
      values.ADMIN_ALERT_EMAIL || 'sidney@institutoeidos.com.br',
      values.ADMIN_ALERT_EMAIL_2 || 'medeiros.sco@gmail.com',
    ].filter((value, index, all) => value && all.indexOf(value) === index);
    return { apiKey: values.RESEND_API_KEY || '', recipients };
  } catch {
    return { apiKey: '', recipients: [] };
  }
}

async function sendFallbackAlert({
  primary,
  fallback,
  reason,
  fetchFn = global.fetch,
  envFile = process.env.ALERT_ENV_FILE || DEFAULT_ENV_FILE,
}) {
  const { apiKey, recipients } = loadAlertConfig(path.resolve(envFile));
  if (!apiKey || recipients.length === 0) return false;

  const subject = `⚠️ WhatsApp EidosForm operando no reserva (${fallback})`;
  const body = [
    'O transporte primário de notificações do EidosForm falhou antes do envio.',
    '',
    `Primário: ${primary}`,
    `Reserva acionado: ${fallback}`,
    `Motivo seguro: ${reason}`,
    `Horário: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Recife' })}`,
    '',
    'Investigue o motor primário. Este alerta é enviado uma vez por incidente.',
  ].join('\n');

  let accepted = false;
  for (const recipient of recipients) {
    try {
      const response = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: FROM, to: [recipient], subject, text: body }),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) accepted = true;
    } catch {
      // O chamador registra apenas o resultado agregado, nunca destinatário/token.
    }
  }
  return accepted;
}

module.exports = { loadAlertConfig, sendFallbackAlert };
