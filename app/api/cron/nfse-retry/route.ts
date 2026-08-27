import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { listInvoicesByStatus, authorizeInvoice, getPaymentById } from '@/lib/asaas'
import { decidirRetentativaNota, MAX_TENTATIVAS_NOTA, nfseEnabled } from '@/lib/nfse'
import { sendBillingOpsAlert } from '@/lib/resend'
import { log, logError, logWarn } from '@/lib/logger'
import { isValidBearerSecret } from '@/lib/bearer-auth'

/**
 * GET /api/cron/nfse-retry — reenvia à prefeitura as NFS-e rejeitadas (cron da VPS, 1x/h).
 *
 * Origem (27/08/2026): a primeira nota de valor cheio voltou com L999 de descrição vazia —
 * instabilidade do webservice municipal, provado por retentativa manual autorizada minutos
 * depois sem nenhuma mudança. Sem este cron, a nota ficava em ERROR até a liquidação do
 * cartão (~1 mês). O pedido é do Sidney: "deu erro, espera um tempo e tenta novamente".
 *
 * Desenho:
 *  - decisão pura em `decidirRetentativaNota` (só notas nossas; pagamento precisa estar
 *    vigente; teto de MAX_TENTATIVAS_NOTA).
 *  - cada tentativa reivindica marcador UNIQUE `nfse-retry:{invoiceId}:{n}` em
 *    asaas_webhook_events — corrida entre dois runners perde no banco, nunca duplica.
 *  - esgotou o teto → alerta ops UMA vez (marcador próprio, devolvido se a entrega falhar —
 *    lição do watchdog de 25/08: só conta o que o canal aceitou).
 *  - CONTABILIDADE FECHADA (lição do expire-plans): total === soma de todos os desfechos.
 */
export async function GET(req: NextRequest) {
  if (!isValidBearerSecret(req.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!nfseEnabled()) return NextResponse.json({ ok: true, desligado: true })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    logError('[cron/nfse-retry] SUPABASE service-role env ausente')
    return NextResponse.json({ error: 'Config indisponível' }, { status: 503 })
  }
  const db = createServiceClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  let notas
  try {
    notas = await listInvoicesByStatus('ERROR')
  } catch (err) {
    // Asaas fora do ar → nada a fazer nesta rodada; a próxima hora tenta de novo.
    logWarn('[cron/nfse-retry] não consegui listar notas — adiando rodada', { err: String(err).slice(0, 120) })
    return NextResponse.json({ ok: true, total: 0, adiado: true })
  }

  let retentadas = 0
  let naoGeridas = 0
  let ilegiveis = 0
  let naoVigentes = 0
  let esgotadas = 0
  let corridas = 0
  let falhas = 0

  for (const nota of notas) {
    const invoiceId = nota.id
    // Quantas tentativas este cron já fez para esta nota (marcadores são a memória).
    const { count } = await db
      .from('asaas_webhook_events')
      .select('event_id', { count: 'exact', head: true })
      .like('event_id', `nfse-retry:${invoiceId}:%`)
    const tentativasFeitas = count ?? 0

    // Estado do pagamento — "não sei" (null) NUNCA vira decisão.
    let paymentStatus: string | null = null
    const paymentId = nota.externalReference?.startsWith('nfse:pay:')
      ? nota.externalReference.slice('nfse:pay:'.length)
      : null
    if (paymentId) {
      const p = await getPaymentById(paymentId).catch(() => ({ ok: false as const, payment: null }))
      paymentStatus = p.ok ? (p.payment?.status ?? null) : null
    }

    const decisao = decidirRetentativaNota({
      externalReference: nota.externalReference,
      paymentStatus,
      tentativasFeitas,
    })

    if (!decisao.retentar) {
      if (decisao.motivo === 'nao_gerida') naoGeridas++
      else if (decisao.motivo === 'pagamento_ilegivel') ilegiveis++
      else if (decisao.motivo === 'pagamento_nao_vigente') naoVigentes++
      else {
        esgotadas++
        // Alerta UMA vez por nota esgotada; entrega falhou → devolve o marcador (25/08).
        const { error: claimErr } = await db
          .from('asaas_webhook_events')
          .insert({ event_id: `nfse-retry-esgotado:${invoiceId}`, event: 'NFSE_RETRY_EXHAUSTED', status: 'processed' })
        if (!claimErr) {
          const entrega = await sendBillingOpsAlert({
            subject: '🔴 NFS-e rejeitada pela prefeitura — retentativas ESGOTADAS',
            lines: {
              'O QUE ISSO SIGNIFICA': `A nota foi reenviada ${MAX_TENTATIVAS_NOTA}x e a prefeitura recusou todas. Não é instabilidade — provável causa cadastral (inscrição municipal, DMS, migração de emissor). Falar com o contador.`,
              nota: invoiceId, pagamento: paymentId ?? '—', valor: String(nota.value ?? '—'),
            },
          }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }))
          if (entrega?.error) {
            await db.from('asaas_webhook_events').delete().eq('event_id', `nfse-retry-esgotado:${invoiceId}`)
            logError('[cron/nfse-retry] alerta de esgotamento NÃO entregue — marcador devolvido', undefined, { invoiceId })
          }
        }
      }
      continue
    }

    // Reivindica a tentativa ANTES de chamar a prefeitura: corrida entre dois runners
    // perde no UNIQUE do banco e sai como 'corrida', nunca como reenvio duplo.
    const n = tentativasFeitas + 1
    const { error: claimErr } = await db
      .from('asaas_webhook_events')
      .insert({ event_id: `nfse-retry:${invoiceId}:${n}`, event: 'NFSE_RETRY', status: 'processed' })
    if (claimErr) { corridas++; continue }

    try {
      const r = await authorizeInvoice(invoiceId)
      retentadas++
      log('[cron/nfse-retry] nota reenviada à prefeitura', { invoiceId, tentativa: n, status: r.status })
    } catch (err) {
      // A tentativa foi gasta de propósito: um authorize que FALHA na API também conta para o
      // teto — senão um erro permanente do Asaas viraria loop infinito sem alarme.
      falhas++
      logError('[cron/nfse-retry] authorize falhou', err, { invoiceId, tentativa: n })
    }
  }

  const total = notas.length
  const resultado = { ok: true, total, retentadas, naoGeridas, ilegiveis, naoVigentes, esgotadas, corridas, falhas }
  if (total > 0) log('[cron/nfse-retry] concluído', resultado)
  return NextResponse.json(resultado)
}
