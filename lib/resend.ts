/**
 * lib/resend.ts — Emails transacionais via Resend
 * Graceful degradation: não crasha se RESEND_API_KEY ausente
 */

import { escapeHtml } from '@/lib/html'
import { logWarn, logError } from '@/lib/logger'
import { createHash } from 'crypto'

// Lidas por chamada (não no import): além de permitir teste sem recarregar o
// módulo, evita congelar uma env que a plataforma injeta tarde.
const getApiKey = () => process.env.RESEND_API_KEY
const getFromEmail = () => process.env.RESEND_FROM_EMAIL ?? 'EidosForm <noreply@eidosform.com.br>'
// Destino dos alertas operacionais de billing (sub órfã, subcobrança pendente etc.).
// Sem fallback hardcoded (P3, auditoria 2026-06-10): se a env sumir, loga erro
// alto em vez de mandar alertas de dinheiro para um endereço fixo no código.
const ADMIN_ALERT_EMAIL = process.env.ADMIN_ALERT_EMAIL ?? ''
if (!ADMIN_ALERT_EMAIL) {
  logError('[resend] ADMIN_ALERT_EMAIL não configurado — alertas operacionais de billing NÃO serão entregues')
}

/** PII patterns to strip from email subjects (P1-N1) */
const PII_PATTERNS = [
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g,          // CPF
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, // email
  /\b(?:\+55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}[-.\s]?\d{4}\b/g, // phone BR
]

/** Teto do assunto. Era 50 — decepava qualquer assunto informativo; 78 é o
 *  ponto onde os clientes de e-mail costumam cortar na listagem. */
export const SUBJECT_MAX_CHARS = 78

/**
 * Sanitiza o assunto do e-mail. A ORDEM importa:
 *  1. remove `\p{Cf}` (invisíveis: zero-width, override bidirecional);
 *  2. converte `\p{Cc}` em espaço — inclui CR/LF, que é o vetor de INJEÇÃO DE
 *     CABEÇALHO (um "\r\nBcc: ..." no nome do lead viraria cabeçalho de verdade);
 *  3. colapsa espaços;
 *  4. só ENTÃO mascara PII (CPF, e-mail, telefone) — se rodasse antes, um CR
 *     no meio de um CPF escaparia do padrão;
 *  5. e por último trunca.
 */
export function sanitizeSubject(subject: string): string {
  let s = String(subject ?? '')
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
  for (const pattern of PII_PATTERNS) {
    s = s.replace(pattern, '***')
  }
  return s.length > SUBJECT_MAX_CHARS ? s.slice(0, SUBJECT_MAX_CHARS - 3) + '...' : s
}

/**
 * Destinatário para LOG: hash curto + domínio. A base de clientes é de
 * psicólogos e o assunto agora carrega o nome do lead — endereço em claro no
 * log de infraestrutura seria vazamento. O hash basta para correlacionar
 * tentativas do mesmo destinatário.
 */
function maskRecipient(to: string): string {
  const digest = createHash('sha256').update(to.trim().toLowerCase()).digest('hex').slice(0, 8)
  const domain = to.includes('@') ? to.slice(to.lastIndexOf('@') + 1) : 'sem-dominio'
  return `${digest}@${domain}`
}

/** Status que vale a pena repetir. 4xx permanente (400/401/403/422) NÃO entra:
 *  repetir só queima cota e atrasa o próximo envio. */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

/** Tempo máximo por tentativa. Sem isto o fetch podia pendurar a execução. */
const REQUEST_TIMEOUT_MS = 10_000

/**
 * Alerta operacional de BILLING para a equipe (não pro cliente). Usado em casos de dinheiro
 * que exigem ação humana: sub órfã do caso A/B (avaliar refund), correção de valor recorrente
 * pendente (risco de subcobrança na renovação), etc. Best-effort e não-bloqueante.
 * Recomendação do audit Codex 2026-06-08 antes de produção.
 */
export async function sendBillingOpsAlert(params: {
  subject: string
  lines: Record<string, string | number | null | undefined>
}): Promise<{ id?: string; error?: string }> {
  const rows = Object.entries(params.lines)
    .map(([k, v]) => `<tr><td style="padding:4px 10px;font-weight:600">${escapeHtml(k)}</td><td style="padding:4px 10px">${escapeHtml(String(v ?? '—'))}</td></tr>`)
    .join('')
  const html = `
    <h2>⚠️ Alerta operacional — Billing</h2>
    <p>${escapeHtml(params.subject)}</p>
    <table style="border-collapse:collapse;border:1px solid #eee">${rows}</table>
    <p style="color:#888;font-size:12px">EidosForm · alerta automático do webhook Asaas</p>
  `
  if (!ADMIN_ALERT_EMAIL) {
    logError('[resend] Alerta de billing DESCARTADO — ADMIN_ALERT_EMAIL ausente', undefined, { subject: params.subject })
    return { error: 'ADMIN_ALERT_EMAIL not configured' }
  }
  return sendEmailWithRetry({ to: ADMIN_ALERT_EMAIL, subject: `[EidosForm ALERTA] ${params.subject}`, html })
}

async function sendEmailWithRetry(payload: {
  to: string
  subject: string
  html: string
  /** Alternativa em texto puro — vai no MESMO payload da Resend. */
  text?: string
  idempotencyKey?: string
}): Promise<{ id?: string; error?: string }> {
  const apiKey = getApiKey()
  if (!apiKey) {
    logWarn('[resend] RESEND_API_KEY not configured')
    return { error: 'RESEND_API_KEY not configured' }
  }

  const fromEmail = getFromEmail()
  const safeSubject = sanitizeSubject(payload.subject)
  const body = JSON.stringify({
    from: fromEmail,
    to: payload.to,
    subject: safeSubject,
    html: payload.html,
    ...(payload.text ? { text: payload.text } : {}),
  })
  const maskedTo = maskRecipient(payload.to)

  const delays = [0, 1000, 5000, 10000]
  let lastError: string | undefined

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, delays[attempt]))
    }

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      }
      if (payload.idempotencyKey) {
        headers['Idempotency-Key'] = payload.idempotencyKey
      }

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      // Corpo pode não ser JSON (502/HTML de proxy) — não pode derrubar o envio.
      const data = await res.json().catch(() => ({} as Record<string, unknown>))
      if (res.ok) {
        // Log SEM PII: nada de assunto (carrega o nome do lead) nem endereço em claro.
        console.log('[resend] email sent', { id: (data as { id?: string }).id, from: fromEmail, to: maskedTo })
        return { id: (data as { id?: string }).id }
      }

      lastError = `HTTP ${res.status}`
      console.error('[resend] API rejected email', { from: fromEmail, to: maskedTo, status: res.status })
      // 4xx permanente: repetir não muda o resultado. Devolve na hora.
      if (!isRetryableStatus(res.status)) return { error: lastError }
    } catch (err) {
      // Timeout (AbortError) e erro de rede SÃO repetíveis.
      const name = err instanceof Error ? err.name : 'Error'
      logError('[resend] Error sending email:', err, { to: maskedTo })
      lastError = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : String(err)
    }
  }

  return { error: lastError }
}

/**
 * Envio de UMA notificação de lead para UM destinatário.
 *
 * Baixo nível de propósito: quem monta a lista de destinatários, normaliza,
 * deduplica e calcula a chave de idempotência é lib/notification-email.ts.
 * Um envio por destinatário (nunca um POST com vários) preserva privacidade,
 * rastreabilidade, retry e idempotência individuais.
 */
export async function sendLeadNotificationEmail(params: {
  to: string
  subject: string
  html: string
  text?: string
  idempotencyKey?: string
}): Promise<{ id?: string; error?: string }> {
  return sendEmailWithRetry(params)
}

// `sendNewResponseNotification` foi REMOVIDA em 2026-07-30. Era um dos DOIS
// construtores de "nova resposta" (o outro era lib/notify.ts), divergentes em
// conteúdo, identidade visual, idempotência e retry. Agora existe um só:
// lib/notification-content.ts monta e lib/notification-email.ts envia.

/** Alerta de 80% do limite de respostas */
export async function sendLimitAlert(params: {
  to: string
  name: string
  usage: number
  limit: number
  plan: string
}) {
  const { to, name, usage, limit, plan } = params
  const pct = Math.round((usage / limit) * 100)
  const safeName = escapeHtml(name)
  return sendEmailWithRetry({
    to,
    subject: `Atenção: você usou ${pct}% do seu limite de respostas`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#f59e0b">⚠️ Limite de respostas se aproximando</h2>
        <p>Olá, <strong>${safeName}</strong>!</p>
        <p>Você já usou <strong>${usage} de ${limit}</strong> respostas do plano <strong>${escapeHtml(plan)}</strong>.</p>
        <p>Para não perder respostas, considere fazer upgrade.</p>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/billing"
           style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none">
          Fazer upgrade
        </a>
        <p style="color:#888;font-size:12px;margin-top:24px">EidosForm — Formulários inteligentes</p>
      </div>
    `,
  })
}

/** Plano ativado com sucesso */
export async function sendPlanActivated(params: {
  to: string
  name: string
  plan: string
}) {
  const { to, name, plan } = params
  const safeName = escapeHtml(name)
  return sendEmailWithRetry({
    to,
    subject: `Plano ${plan} ativado! 🚀`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#10b981">Plano ativado com sucesso! 🚀</h2>
        <p>Olá, <strong>${safeName}</strong>!</p>
        <p>Seu plano <strong>${escapeHtml(plan)}</strong> foi ativado. Aproveite todos os recursos!</p>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard"
           style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none">
          Acessar dashboard
        </a>
        <p style="color:#888;font-size:12px;margin-top:24px">EidosForm — Formulários inteligentes</p>
      </div>
    `,
  })
}

/**
 * Troca de plano (upgrade/downgrade) — espelho do WhatsApp `plano_alterado`
 * (premissa P1 da mesa 2026-08-03: todo evento de plano gera e-mail; mesmo
 * gatilho, mesma idempotência do fan-out no executePlanSwitch). Sem isto, o
 * upgrade ficaria com ZERO e-mail após a supressão do "plano ativado" indevido.
 */
export async function sendPlanChanged(params: {
  to: string
  name: string
  fromPlan: string
  toPlan: string
  nextCharge?: string | null
  /** ex.: hash de plan-changed:<newSubId> — 1 e-mail por troca, mesmo com retry. */
  idempotencyKey?: string
}) {
  const { to, name, fromPlan, toPlan, nextCharge, idempotencyKey } = params
  const safeName = escapeHtml(name)
  const chargeLine = nextCharge
    ? `<p>Próxima cobrança: <strong>${escapeHtml(nextCharge)}</strong>.</p>`
    : ''
  return sendEmailWithRetry({
    to,
    subject: `Seu plano mudou: ${toPlan}`,
    idempotencyKey,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#6366f1">Alteração de plano confirmada</h2>
        <p>Olá, <strong>${safeName}</strong>!</p>
        <p>Sua assinatura EidosForm mudou de <strong>${escapeHtml(fromPlan)}</strong> para <strong>${escapeHtml(toPlan)}</strong>.</p>
        ${chargeLine}
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/billing"
           style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none">
          Gerenciar assinatura
        </a>
        <p style="color:#888;font-size:12px;margin-top:24px">EidosForm — Formulários inteligentes</p>
      </div>
    `,
  })
}

/**
 * Acesso atualizado pelo ADMIN (cortesia/ajuste de data) — espelho do WhatsApp
 * `acesso_atualizado` (premissa P1 da mesa 2026-08-03; Fase 4 do painel).
 */
export async function sendAccessUpdated(params: {
  to: string
  name: string
  plan: string
  validUntil: string
  idempotencyKey?: string
}) {
  const { to, name, plan, validUntil, idempotencyKey } = params
  const safeName = escapeHtml(name)
  return sendEmailWithRetry({
    to,
    subject: `Seu acesso ao ${plan} foi atualizado`,
    idempotencyKey,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#6366f1">Atualização da sua conta</h2>
        <p>Olá, <strong>${safeName}</strong>!</p>
        <p>Seu acesso ao plano <strong>${escapeHtml(plan)}</strong> agora é válido até <strong>${escapeHtml(validUntil)}</strong>.</p>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/login"
           style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none">
          Acessar minha conta
        </a>
        <p style="color:#888;font-size:12px;margin-top:24px">EidosForm — Formulários inteligentes</p>
      </div>
    `,
  })
}

/** Segurança: telefone da conta ALTERADO (camada 1 da propagação, 05/08). */
export async function sendPhoneChangedEmail(params: {
  to: string
  name: string
  oldPhoneMasked: string
  newPhoneMasked: string
}) {
  const { to, name, oldPhoneMasked, newPhoneMasked } = params
  return sendEmailWithRetry({
    to,
    subject: 'Alteração no telefone da sua conta EidosForm',
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#f59e0b">Telefone alterado</h2>
        <p>Olá, <strong>${escapeHtml(name)}</strong>!</p>
        <p>O telefone de contato da sua conta foi alterado de <strong>${escapeHtml(oldPhoneMasked)}</strong> para <strong>${escapeHtml(newPhoneMasked)}</strong>.</p>
        <p><strong>Foi você?</strong> Então está tudo certo — as confirmações da sua conta passam a chegar no número novo.</p>
        <p>Se <strong>não</strong> foi você, responda este e-mail imediatamente para nossa equipe proteger sua conta.</p>
        <p style="color:#888;font-size:12px;margin-top:24px">EidosForm — Formulários inteligentes</p>
      </div>
    `,
  })
}

/** Webhook do formulário falhando após 3+ falhas em 7 dias (J1) */
export async function sendWebhookFailureAlert(params: {
  to: string
  formTitle: string
  formId: string
  failures: Array<{ webhook_url: string; last_error: string; created_at: string }>
}) {
  const { to, formTitle, formId, failures } = params
  const safeTitle = escapeHtml(formTitle)
  const items = failures
    .slice(0, 3)
    .map(
      (f) => `
        <li style="margin-bottom:12px">
          <div><strong>URL:</strong> <code>${escapeHtml(f.webhook_url)}</code></div>
          <div><strong>Erro:</strong> ${escapeHtml(f.last_error || 'desconhecido')}</div>
          <div style="color:#888;font-size:12px">Quando: ${escapeHtml(f.created_at)}</div>
        </li>`,
    )
    .join('')
  const idempotencyKey = createHash('sha256')
    .update(`webhook-failure:${formId}:${failures[0]?.created_at ?? ''}`)
    .digest('hex')
  return sendEmailWithRetry({
    to,
    subject: `Webhook do formulário "${safeTitle}" falhando`,
    idempotencyKey,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#ef4444">⚠️ Webhook falhando</h2>
        <p>O webhook configurado no formulário <strong>${safeTitle}</strong> falhou ao menos 3 vezes nos últimos 7 dias.</p>
        <p>Últimas falhas:</p>
        <ul style="padding-left:20px">${items}</ul>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/forms/${formId}/edit"
           style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none">
          Abrir formulário
        </a>
        <p style="color:#888;font-size:12px;margin-top:8px">Acesse a aba "Integrações" para revisar a URL do webhook.</p>
        <p style="color:#888;font-size:12px;margin-top:24px">EidosForm — Formulários inteligentes</p>
      </div>
    `,
  })
}

/** Plano cancelado */
export async function sendPlanCancelled(params: {
  to: string
  name: string
  plan: string
}) {
  const { to, name, plan } = params
  const safeName = escapeHtml(name)
  return sendEmailWithRetry({
    to,
    subject: `Assinatura ${plan} cancelada`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#ef4444">Assinatura cancelada</h2>
        <p>Olá, <strong>${safeName}</strong>!</p>
        <p>Sua assinatura do plano <strong>${escapeHtml(plan)}</strong> foi cancelada. Você voltou para o plano Free.</p>
        <p>Se foi um engano ou quer reativar, acesse seu dashboard.</p>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/billing"
           style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none">
          Reativar plano
        </a>
        <p style="color:#888;font-size:12px;margin-top:24px">EidosForm — Formulários inteligentes</p>
      </div>
    `,
  })
}
