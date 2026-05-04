/**
 * lib/resend.ts — Emails transacionais via Resend
 * Graceful degradation: não crasha se RESEND_API_KEY ausente
 */

import { escapeHtml } from '@/lib/html'
import { logWarn, logError } from '@/lib/logger'
import { createHash } from 'crypto'

const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'EidosForm <noreply@eidosform.com.br>'

/** PII patterns to strip from email subjects (P1-N1) */
const PII_PATTERNS = [
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g,          // CPF
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, // email
  /\b(?:\+55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}[-.\s]?\d{4}\b/g, // phone BR
]

/**
 * Sanitize email subject: truncate to 50 chars and strip PII patterns.
 */
function sanitizeSubject(subject: string): string {
  let s = subject
  for (const pattern of PII_PATTERNS) {
    s = s.replace(pattern, '***')
  }
  return s.length > 50 ? s.slice(0, 47) + '...' : s
}

async function sendEmailWithRetry(payload: {
  to: string
  subject: string
  html: string
  idempotencyKey?: string
}): Promise<{ id?: string; error?: string }> {
  if (!RESEND_API_KEY) {
    logWarn('[resend] RESEND_API_KEY not configured')
    return { error: 'RESEND_API_KEY not configured' }
  }

  const safeSubject = sanitizeSubject(payload.subject)
  const body = JSON.stringify({
    from: FROM_EMAIL,
    to: payload.to,
    subject: safeSubject,
    html: payload.html,
  })

  const delays = [0, 1000, 5000, 10000]
  let lastError: string | undefined

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, delays[attempt]))
    }

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      }
      if (payload.idempotencyKey) {
        headers['Idempotency-Key'] = payload.idempotencyKey
      }

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers,
        body,
      })
      const data = await res.json()
      if (res.ok) {
        console.log('[resend] email sent', { id: data.id, from: FROM_EMAIL, to: payload.to, subject: safeSubject })
        return { id: data.id }
      }
      lastError = JSON.stringify(data)
      console.error('[resend] API rejected email', { from: FROM_EMAIL, to: payload.to, subject: safeSubject, status: res.status, data })
    } catch (err) {
      logError('[resend] Error sending email:', err)
      lastError = String(err)
    }
  }

  return { error: lastError }
}

/** Nova resposta recebida em um formulário */
export async function sendNewResponseNotification(params: {
  to: string
  formTitle: string
  responseId: string
  formId: string
}) {
  const { to, formTitle, responseId, formId } = params
  const safeFormTitle = escapeHtml(formTitle)

  // Idempotency key = hash(formId + responseId) to avoid duplicate emails on retry
  const idempotencyKey = createHash('sha256')
    .update(`new-response:${formId}:${responseId}`)
    .digest('hex')

  return sendEmailWithRetry({
    to,
    subject: `Nova resposta em "${safeFormTitle}"`,
    idempotencyKey,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#6366f1">Nova resposta recebida! 🎉</h2>
        <p>Seu formulário <strong>${safeFormTitle}</strong> recebeu uma nova resposta.</p>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/forms/${formId}/responses/${responseId}"
           style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none">
          Ver resposta
        </a>
        <p style="color:#888;font-size:12px;margin-top:24px">EidosForm — Formulários inteligentes</p>
      </div>
    `,
  })
}

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
