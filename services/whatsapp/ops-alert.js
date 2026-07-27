'use strict';

/**
 * Canal de alerta operacional (e-mail via Resend, 2 destinatários redundantes).
 *
 * Generalização do antigo `fallback-alert.js`, que só sabia avisar de fallback.
 * O incidente de 2026-07-27 mostrou o furo: o healthcheck vigia se a SESSÃO
 * está autenticada, e `authenticated=true` seguiu verdadeiro por 9 horas
 * enquanto TODO envio falhava. Ninguém vigiava o resultado do envio.
 *
 * Assunto sempre prefixado e sem dado de lead: nem telefone, nem conteúdo.
 */

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

/**
 * @param {object} opts
 * @param {string} opts.subject  assunto já legível para humano
 * @param {string[]} opts.lines  corpo, uma frase por linha (sem PII)
 * @returns {Promise<boolean>} true se ao menos um destinatário aceitou
 */
async function sendOpsAlert({
  subject,
  lines = [],
  fetchFn = global.fetch,
  envFile = process.env.ALERT_ENV_FILE || DEFAULT_ENV_FILE,
  now = () => new Date(),
}) {
  const { apiKey, recipients } = loadAlertConfig(path.resolve(envFile));
  if (!apiKey || recipients.length === 0) return false;

  const body = [
    ...lines,
    '',
    `Horário: ${now().toLocaleString('pt-BR', { timeZone: 'America/Recife' })}`,
    'Painel: https://eidosform.com.br/admin/whatsapp',
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
      // O chamador registra só o resultado agregado, nunca destinatário/token.
    }
  }
  return accepted;
}

function sendFallbackAlert({ primary, fallback, reason, ...rest }) {
  return sendOpsAlert({
    subject: `⚠️ WhatsApp EidosForm operando no reserva (${fallback})`,
    lines: [
      'O transporte primário de notificações falhou ANTES do envio.',
      '',
      `Primário: ${primary}`,
      `Reserva acionado: ${fallback}`,
      `Motivo seguro: ${reason}`,
      '',
      'As notificações seguem saindo pelo reserva. Investigue o motor primário.',
      'Este alerta é enviado uma vez por incidente.',
    ],
    ...rest,
  });
}

function sendSendFailureAlert({ consecutive, transport, error, queued, ...rest }) {
  return sendOpsAlert({
    subject: `🚨 WhatsApp EidosForm: os ENVIOS estão falhando (${consecutive} seguidos)`,
    lines: [
      `${consecutive} envios consecutivos falharam pelo motor "${transport}".`,
      `Último erro: ${error}`,
      '',
      `Notificações na fila de reenvio: ${queued}. Elas NÃO foram perdidas —`,
      'serão reentregues sozinhas quando o transporte voltar.',
      '',
      'ATENÇÃO: a sessão pode aparecer como "conectada" e mesmo assim não enviar.',
      'Foi exatamente o que aconteceu em 27/07/2026. Confie neste alerta, não no selo verde.',
    ],
    ...rest,
  });
}

function sendDeadLetterAlert({ count, oldest, ...rest }) {
  return sendOpsAlert({
    subject: `🚨 WhatsApp EidosForm: ${count} notificação(ões) DESISTIRAM de ser entregues`,
    lines: [
      `${count} notificação(ões) esgotaram todas as tentativas de reenvio e foram descartadas.`,
      oldest ? `A mais antiga falhou pela primeira vez em: ${oldest}` : '',
      '',
      'Estes leads existem no banco, mas você NÃO foi avisado deles.',
      'Confira as respostas recentes do formulário no painel do EidosForm.',
    ].filter(Boolean),
    ...rest,
  });
}

function sendVolumeAlert({ today, average7Days, ...rest }) {
  return sendOpsAlert({
    subject: `📈 WhatsApp EidosForm: volume de hoje ${today} vs média ${average7Days}/dia`,
    lines: [
      `Hoje já saíram ${today} notificações; a média dos últimos 7 dias é ${average7Days}/dia.`,
      '',
      'Isto normalmente significa campanha em captação — não é um erro.',
      'É um aviso ANTECIPADO: em 07/2026 o volume subiu 25× em 4 dias sem ninguém ver,',
      'e foi isso que derrubou a sessão do WhatsApp duas vezes.',
      '',
      'Enviado no máximo uma vez por dia.',
    ],
    ...rest,
  });
}

module.exports = {
  loadAlertConfig,
  sendOpsAlert,
  sendFallbackAlert,
  sendSendFailureAlert,
  sendDeadLetterAlert,
  sendVolumeAlert,
};
