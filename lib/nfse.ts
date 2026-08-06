import { listInvoicesByPayment, scheduleInvoiceForPayment, cancelInvoice } from '@/lib/asaas'
import { sendBillingOpsAlert } from '@/lib/resend'
import { log, logError } from '@/lib/logger'

/**
 * NFS-e automática do EidosForm (decisão Sidney 2026-08-05).
 *
 * Regra: TODO pagamento CONFIRMADO gera uma nota (assinatura, renovação, avulso de
 * troca de plano, fallback de cartão) — semântica ON_PAYMENT_CONFIRMATION implementada
 * no nosso webhook, porque o Asaas não tem automação global de conta e as assinaturas
 * nascem por código (sem tela onde marcar a opção). Estorno/chargeback cancela a nota.
 *
 * O serviço municipal é o de TREINAMENTO (859960400 - 0802) do Instituto Eidos —
 * incoerência com licenciamento de software ASSUMIDA CONSCIENTEMENTE pelo Sidney
 * (decisão fechada 05/08, não reabrir); migra p/ PJ de tecnologia quando ela existir.
 * Config validada em produção com 3 notas autorizadas pela PMJP (1.013.703-705):
 * série 2, alíquota declarada 0 (o município calcula o ISS efetivo do Simples e o
 * padrão nacional mascara com ***** — não é bug), retenções zeradas.
 */

/** Kill-switch: NFSE_EMIT_ENABLED='0' desliga emissão E cancelamento automáticos. */
export function nfseEnabled(): boolean {
  return process.env.NFSE_EMIT_ENABLED !== '0'
}

// id 325850 no catálogo municipalServices da conta = "859960400 - 0802 - Treinamento
// em desenvolvimento profissional e gerencial", ISS 0%. É o ÚNICO formato que a PMJP
// aceita (o de 7 dígitos é rejeitado com L999 atividadeNaoInformada).
const MUNICIPAL_SERVICE_ID = process.env.NFSE_MUNICIPAL_SERVICE_ID ?? '325850'
const MUNICIPAL_SERVICE_NAME =
  process.env.NFSE_MUNICIPAL_SERVICE_NAME ?? 'Treinamento em desenvolvimento profissional e gerencial'
const SERVICE_DESCRIPTION =
  process.env.NFSE_SERVICE_DESCRIPTION ?? 'Treinamento e desenvolvimento profissional em soluções digitais e educacionais'

// Alíquotas zeradas: Simples Nacional — tributos no DAS; a PMJP calcula o ISS efetivo
// por conta própria independente do declarado (provado nos testes 1013704/1013705).
const TAXES = { retainIss: false, iss: 0, pis: 0, cofins: 0, csll: 0, inss: 0, ir: 0 }

function hojeISO(): string {
  // Data local de São Paulo (UTC-3): meia-noite UTC ainda é o dia anterior no Brasil,
  // e effectiveDate no futuro adiaria a emissão.
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * Agenda a NFS-e de um pagamento confirmado. Idempotente por cobrança: se já existe
 * nota não-ERROR vinculada (inclusive CANCELED — ex.: estorno entre o CONFIRMED e o
 * RECEIVED do cartão), não emite outra. Nota anterior em ERROR (rejeição da
 * prefeitura) permite nova tentativa no próximo evento do pagamento.
 * Best-effort: falha vira alerta operacional, nunca quebra o webhook.
 */
export async function emitirNotaParaPagamento(params: {
  paymentId: string
  value: number
  customerEmail?: string | null
}): Promise<'scheduled' | 'skipped' | 'failed'> {
  const { paymentId, value } = params
  if (!nfseEnabled()) return 'skipped'
  if (!paymentId || !(value > 0)) return 'skipped'
  try {
    const existentes = await listInvoicesByPayment(paymentId)
    const vigente = existentes.find((inv) => inv.status !== 'ERROR')
    if (vigente) {
      log('[nfse] emissão pulada — pagamento já tem nota', { paymentId, invoiceId: vigente.id, status: vigente.status })
      return 'skipped'
    }
    const created = await scheduleInvoiceForPayment({
      paymentId,
      value,
      effectiveDate: hojeISO(),
      serviceDescription: SERVICE_DESCRIPTION,
      observations: 'Assinatura EidosForm',
      municipalServiceId: MUNICIPAL_SERVICE_ID,
      municipalServiceName: MUNICIPAL_SERVICE_NAME,
      externalReference: `nfse:pay:${paymentId}`,
      taxes: TAXES,
    })
    log('[nfse] nota agendada', { paymentId, invoiceId: created.id, status: created.status, value })
    return 'scheduled'
  } catch (err) {
    logError('[nfse] falha ao agendar nota — emitir MANUALMENTE no painel', err, { paymentId, value })
    await sendBillingOpsAlert({
      subject: `🧾 NFS-e NÃO agendada para pagamento de R$${value.toFixed(2)} — emitir manualmente`,
      lines: {
        'O que houve': 'O agendamento automático da nota fiscal falhou. A cobrança está paga; só a nota ficou pendente.',
        'AÇÃO': 'Emitir a nota manualmente no painel Asaas (Notas Fiscais → vincular à cobrança) ou aguardar o próximo evento do pagamento re-tentar.',
        cobranca: paymentId,
        valor: `R$${value.toFixed(2)}`,
        cliente: params.customerEmail ?? null,
        erro: err instanceof Error ? err.message.slice(0, 200) : String(err),
      },
    }).catch(() => {})
    return 'failed'
  }
}

/**
 * Cancela a(s) NFS-e de um pagamento estornado/contestado. Só age sobre notas
 * canceláveis (SCHEDULED/SYNCHRONIZED/AUTHORIZED). Se a prefeitura negar (prazo
 * municipal vencido → CANCELLATION_DENIED chega async) ou a chamada falhar,
 * alerta operacional para tratamento manual com o contador.
 */
export async function cancelarNotasDoPagamento(params: {
  paymentId: string
  motivo: string
  customerEmail?: string | null
}): Promise<'cancelled' | 'noop' | 'failed'> {
  const { paymentId, motivo } = params
  if (!nfseEnabled()) return 'noop'
  if (!paymentId) return 'noop'
  try {
    const notas = await listInvoicesByPayment(paymentId)
    const cancelaveis = notas.filter((inv) => inv.status === 'SCHEDULED' || inv.status === 'SYNCHRONIZED' || inv.status === 'AUTHORIZED')
    if (cancelaveis.length === 0) {
      log('[nfse] nada a cancelar para o pagamento', { paymentId, motivo, statuses: notas.map((n) => n.status) })
      return 'noop'
    }
    const falhas: string[] = []
    for (const inv of cancelaveis) {
      try {
        const r = await cancelInvoice(inv.id)
        log('[nfse] cancelamento solicitado', { paymentId, invoiceId: inv.id, status: r.status, motivo })
      } catch (err) {
        falhas.push(`${inv.id} (${inv.number ?? inv.status}): ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`)
      }
    }
    if (falhas.length > 0) {
      logError('[nfse] cancelamento de nota FALHOU — cancelar manualmente', undefined, { paymentId, falhas })
      await sendBillingOpsAlert({
        subject: `🧾 Cancelamento de NFS-e FALHOU após ${motivo} — cancelar manualmente`,
        lines: {
          'O que houve': 'O pagamento foi estornado/contestado, mas o cancelamento automático da nota fiscal falhou (pode ser prazo municipal vencido).',
          'AÇÃO': 'Cancelar a nota no painel Asaas; se a prefeitura negar, tratar com o contador (nota sem receita correspondente).',
          cobranca: paymentId,
          cliente: params.customerEmail ?? null,
          notas: falhas.join(' · '),
          motivo,
        },
      }).catch(() => {})
      return 'failed'
    }
    return 'cancelled'
  } catch (err) {
    logError('[nfse] falha ao listar/cancelar notas do pagamento', err, { paymentId, motivo })
    await sendBillingOpsAlert({
      subject: `🧾 Cancelamento de NFS-e FALHOU após ${motivo} — verificar manualmente`,
      lines: {
        'O que houve': 'Não consegui nem listar as notas da cobrança estornada — estado desconhecido.',
        'AÇÃO': 'Conferir no painel Asaas se existe nota emitida para esta cobrança e cancelar se houver.',
        cobranca: paymentId,
        cliente: params.customerEmail ?? null,
        erro: err instanceof Error ? err.message.slice(0, 200) : String(err),
        motivo,
      },
    }).catch(() => {})
    return 'failed'
  }
}
