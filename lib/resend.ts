/**
 * lib/resend.ts — Emails transacionais via Resend
 * Sprint Dia 4-5 — EidosForm
 * Graceful degradation: não crasha se RESEND_API_KEY ausente
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'EidosForm <noreply@eidosform.com.br>'

async function sendEmail(payload: {
  to: string
  subject: string
  html: string
}): Promise<{ id?: string; error?: string }> {
  if (!RESEND_API_KEY) {
    console.warn('[resend] RESEND_API_KEY não configurada — email não enviado:', payload.subject)
    return { error: 'RESEND_API_KEY not configured' }
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
      }),
    })
    const data = await res.json()
    if (!res.ok) return { error: JSON.stringify(data) }
    return { id: data.id }
  } catch (err) {
    console.error('[resend] Erro ao enviar email:', err)
    return { error: String(err) }
  }
}

/** Nova resposta recebida em um formulário */
export async function sendNewResponseNotification(params: {
  to: string
  formTitle: string
  responseId: string
  formId: string
}) {
  const { to, formTitle, responseId, formId } = params
  return sendEmail({
    to,
    subject: `Nova resposta em "${formTitle}"`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#6366f1">Nova resposta recebida! 🎉</h2>
        <p>Seu formulário <strong>${formTitle}</strong> recebeu uma nova resposta.</p>
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
  return sendEmail({
    to,
    subject: `Atenção: você usou ${pct}% do seu limite de respostas`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#f59e0b">⚠️ Limite de respostas se aproximando</h2>
        <p>Olá, <strong>${name}</strong>!</p>
        <p>Você já usou <strong>${usage} de ${limit}</strong> respostas do plano <strong>${plan}</strong>.</p>
        <p>Para não perder respostas, considere fazer upgrade.</p>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/upgrade"
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
  return sendEmail({
    to,
    subject: `Plano ${plan} ativado! 🚀`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#10b981">Plano ativado com sucesso! 🚀</h2>
        <p>Olá, <strong>${name}</strong>!</p>
        <p>Seu plano <strong>${plan}</strong> foi ativado. Aproveite todos os recursos!</p>
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
  return sendEmail({
    to,
    subject: `Assinatura ${plan} cancelada`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#ef4444">Assinatura cancelada</h2>
        <p>Olá, <strong>${name}</strong>!</p>
        <p>Sua assinatura do plano <strong>${plan}</strong> foi cancelada. Você voltou para o plano Free.</p>
        <p>Se foi um engano ou quer reativar, acesse seu dashboard.</p>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/upgrade"
           style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none">
          Reativar plano
        </a>
        <p style="color:#888;font-size:12px;margin-top:24px">EidosForm — Formulários inteligentes</p>
      </div>
    `,
  })
}
