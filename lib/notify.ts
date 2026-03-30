/**
 * Notificação por email configurada pelo dono do formulário.
 * Usa a API Resend via fetch (mesmo padrão de lib/resend.ts).
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'EidosForm <notificacoes@eidosform.com.br>'

export async function sendEmailNotification({
  toEmail,
  formTitle,
  formId,
  answersCount,
}: {
  toEmail: string
  formTitle: string
  formId: string
  answersCount: number
}) {
  if (!RESEND_API_KEY) {
    console.warn('[notify] RESEND_API_KEY not set — skipping notification')
    return
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
        to: toEmail,
        subject: `Nova resposta em "${formTitle}"`,
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
            <h2 style="color: #1E3A5F;">Nova resposta recebida!</h2>
            <p>O formulário <strong>${formTitle}</strong> acaba de receber uma nova resposta com ${answersCount} campo(s) preenchido(s).</p>
            <a href="https://eidosform.com.br/dashboard/forms/${formId}/responses"
               style="display: inline-block; background: #F5B731; color: #000; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; margin-top: 16px;">
              Ver resposta
            </a>
            <p style="color: #888; font-size: 12px; margin-top: 24px;">
              Para parar de receber notificações, desative em Integrações → Notificação por E-mail.
            </p>
          </div>
        `,
      }),
    })

    if (!res.ok) {
      const error = await res.text()
      console.error('[notify] Resend API error:', res.status, error)
    }
  } catch (e) {
    // Silencioso — não quebrar o fluxo principal
    console.error('Email notification failed:', e)
  }
}
