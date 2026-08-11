/**
 * Aviso de billing NO WHATSAPP DO DONO DA PLATAFORMA (decisão Sidney 11/08/2026).
 *
 * "Quero receber uma mensagem sempre que houver alguma alteração de pagamento — compra,
 * upgrade, downgrade, cancelamento." Até aqui o dono só ficava sabendo por e-mail, e só dos
 * PROBLEMAS (sendBillingOpsAlert); os eventos felizes não avisavam ninguém além do cliente.
 *
 * CANAL: o serviço de WhatsApp da VPS — o mesmo que entrega os avisos de lead. É texto livre,
 * sem template da Meta para aprovar, e o destino é o número do dono (ADMIN_ALERT_WHATSAPP).
 * NÃO confundir com as confirmações ao CLIENTE, que saem pelo número da Elen via Cloud API
 * com template aprovado — são dois canais distintos de propósito: o da Cloud API exigiria
 * template (e categoria UTILITY) para cada frase nova daqui.
 *
 * CONTRATO: melhor esforço, SEMPRE. Esta função nunca lança e nunca deve estar no caminho
 * crítico de dinheiro — um WhatsApp fora do ar não pode impedir uma ativação de plano.
 * O e-mail continua sendo o canal de registro; isto é o espelho de bolso.
 */
import { getWhatsappUrl, getWhatsappAuthHeaders } from '@/lib/whatsapp-client'
import { log, logWarn } from '@/lib/logger'

export async function notifyBillingOpsWhatsApp(
  texto: string,
  /** Chave de idempotência: o webhook reprocessa eventos, e o dono não precisa de eco. */
  chave?: string,
): Promise<{ sent: boolean; skipped?: string }> {
  try {
    const numero = process.env.ADMIN_ALERT_WHATSAPP?.replace(/\D/g, '')
    if (!numero) {
      // Ausência da env é configuração, não erro — mas fica visível no log para não
      // repetir a história do alerta que "existia" e nunca chegava a ninguém.
      logWarn('[billing-ops-wpp] ADMIN_ALERT_WHATSAPP ausente — aviso de billing NÃO enviado ao dono')
      return { sent: false, skipped: 'no_admin_number' }
    }

    const res = await fetch(getWhatsappUrl('/api/whatsapp/send'), {
      method: 'POST',
      headers: { ...getWhatsappAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: numero,
        message: texto,
        ...(chave ? { idempotencyKey: `ops-billing:${chave}` } : {}),
      }),
      // Curto de propósito: quem chama está em webhook/cron com orçamento de tempo.
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      logWarn('[billing-ops-wpp] VPS recusou o aviso (não bloqueante)', { status: res.status })
      return { sent: false, skipped: `vps_${res.status}` }
    }
    log('[billing-ops-wpp] Aviso de billing enviado ao dono', { chave: chave ?? null })
    return { sent: true }
  } catch (err) {
    logWarn('[billing-ops-wpp] Exceção no aviso (não bloqueante)', { err: String(err).slice(0, 120) })
    return { sent: false, skipped: 'exception' }
  }
}
