/**
 * Notificações por email via Resend
 * Configure RESEND_API_KEY no .env para ativar o envio.
 */

import { escapeHtml } from '@/lib/html'

const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = process.env.EMAIL_FROM || 'noreply@eidosform.com'

interface EmailPayload {
  from: string
  to: string[]
  subject: string
  html: string
}

async function sendEmail(payload: EmailPayload): Promise<void> {
  if (!RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set — skipping:', payload.subject)
    return
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const error = await res.text()
    throw new Error(`Resend API error ${res.status}: ${error}`)
  }
}

/**
 * Notifica o dono do formulário sobre nova resposta recebida.
 */
export async function sendNewResponseNotification(
  formId: string,
  userId: string,
  responseId: string
): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    console.warn('[email] Supabase credentials not configured')
    return
  }

  // Buscar email do dono
  const profileRes = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=email,full_name`,
    { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } }
  )
  const profiles = profileRes.ok ? await profileRes.json() : []
  const profile = profiles?.[0]
  if (!profile?.email) return

  // Buscar título do formulário
  const formRes = await fetch(
    `${supabaseUrl}/rest/v1/forms?id=eq.${formId}&select=title`,
    { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } }
  )
  const forms = formRes.ok ? await formRes.json() : []
  const formTitle = forms?.[0]?.title || 'Formulário sem título'
  const safeFormTitle = escapeHtml(formTitle)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.eidosform.com'
  const dashboardUrl = `${appUrl}/dashboard/forms/${formId}/responses`
  const name = profile.full_name ? `, ${profile.full_name}` : ''

  await sendEmail({
    from: FROM_EMAIL,
    to: [profile.email],
    subject: `Nova resposta em "${safeFormTitle}"`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <h2 style="color:#1a1a2e;">📋 Nova resposta recebida!</h2>
        <p>Olá${name},</p>
        <p>Você recebeu uma nova resposta no formulário <strong>"${safeFormTitle}"</strong>.</p>
        <p style="margin:24px 0;">
          <a href="${dashboardUrl}"
             style="background:#6366f1;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">
            Ver respostas
          </a>
        </p>
        <p style="color:#666;font-size:13px;">ID da resposta: <code>${responseId}</code></p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;"/>
        <p style="color:#999;font-size:12px;">
          EidosForm — Formulários que convertem.
        </p>
      </div>
    `,
  })
}
