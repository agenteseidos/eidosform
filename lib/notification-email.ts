/**
 * lib/notification-email.ts — ORQUESTRADOR de destinatários do e-mail de lead.
 *
 * Fino de propósito: resolve QUEM recebe, normaliza, deduplica e chama o
 * sender UMA VEZ POR DESTINATÁRIO. Não monta conteúdo (isso é
 * lib/notification-content.ts) e não fala com a Resend direto
 * (isso é sendLeadNotificationEmail em lib/resend.ts).
 *
 * Por que um envio por destinatário, e não um POST com vários endereços:
 * privacidade (um destinatário veria o outro), rastreabilidade, retry e
 * idempotência individuais.
 */

import { createHash } from 'crypto'
import { sendLeadNotificationEmail } from './resend'
import { buildNewResponseEmail } from './notification-content'
import type { NotificationModel } from './notification-model'

/**
 * `owner` = dono da conta; `form_email` = endereço extra configurado em
 * Integrações. Os papéis já nascem com os nomes que a tabela de claim da
 * Entrega 2 vai usar (`recipient_role`).
 */
export type RecipientRole = 'owner' | 'form_email'

export interface EmailRecipient {
  email: string
  role: RecipientRole
}

/**
 * Lista final de destinatários: normalizada (`trim().toLowerCase()`) e
 * deduplicada.
 *
 * A dedup EXATA de antes (`form.notify_email !== ownerProfile?.email`) era
 * sensível a caixa e espaço: " Dono@Clinica.com " e "dono@clinica.com" eram
 * tratados como pessoas diferentes e o mesmo humano recebia dois e-mails.
 *
 * Regra de negócio preservada: TODO formulário de dono habilitado notifica o
 * e-mail do DONO; `notify_email_enabled` apenas ACRESCENTA um segundo
 * destinatário. Em empate, o papel `owner` prevalece (é o primeiro da lista).
 */
export function resolveEmailRecipients(input: {
  ownerEmail?: string | null
  notifyEmail?: string | null
  notifyEmailEnabled?: boolean | null
}): EmailRecipient[] {
  const candidates: EmailRecipient[] = []
  const normalize = (v: string | null | undefined) => (v ?? '').trim().toLowerCase()

  const owner = normalize(input.ownerEmail)
  if (owner) candidates.push({ email: owner, role: 'owner' })

  const extra = normalize(input.notifyEmail)
  if (input.notifyEmailEnabled && extra) candidates.push({ email: extra, role: 'form_email' })

  const seen = new Set<string>()
  return candidates.filter((r) => {
    if (seen.has(r.email)) return false
    seen.add(r.email)
    return true
  })
}

/**
 * Chave de idempotência POR DESTINATÁRIO. O endereço entra no hash e não
 * precisa aparecer em claro.
 *
 * Sem o destinatário na chave, os dois e-mails LEGÍTIMOS de uma mesma resposta
 * (dono + endereço extra) colidiriam na Resend e um sumiria em silêncio.
 */
export function buildEmailIdempotencyKey(params: {
  event: 'new-response'
  formId: string
  responseId: string
  email: string
}): string {
  const normalized = params.email.trim().toLowerCase()
  return createHash('sha256')
    .update(`${params.event}-email:v1:${params.formId}:${params.responseId}:${normalized}`)
    .digest('hex')
}

export interface EmailSendOutcome {
  role: RecipientRole
  id?: string
  error?: string
}

/**
 * Monta o e-mail de nova resposta UMA vez e envia para cada destinatário.
 * Nunca lança: uma falha de e-mail não pode derrubar o pós-submit.
 */
export async function sendNewResponseEmails(params: {
  model: NotificationModel
  recipients: EmailRecipient[]
}): Promise<EmailSendOutcome[]> {
  const { model, recipients } = params
  if (recipients.length === 0) return []

  const content = buildNewResponseEmail(model)

  return Promise.all(
    recipients.map(async (recipient) => {
      try {
        const result = await sendLeadNotificationEmail({
          to: recipient.email,
          subject: content.subject,
          html: content.html,
          text: content.text,
          idempotencyKey: buildEmailIdempotencyKey({
            event: 'new-response',
            formId: model.form.id,
            responseId: model.response.id,
            email: recipient.email,
          }),
        })
        return { role: recipient.role, ...result }
      } catch (err) {
        return { role: recipient.role, error: err instanceof Error ? err.message : String(err) }
      }
    })
  )
}
