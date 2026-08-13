import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { isValidBearerSecret } from '@/lib/bearer-auth'
import { log, logError, logWarn } from '@/lib/logger'
import { hasOverduePaymentForSubscription, getLinkPagamentoVencido } from '@/lib/asaas'
import { sendDunningEmail, sendBillingOpsAlert } from '@/lib/resend'
import { notifyBillingOpsWhatsApp } from '@/lib/billing-ops-whatsapp'
import { planLabel } from '@/lib/whatsapp-confirmations'
import {
  decidirAviso, detectarRebaixamentoAtrasado, ehHoraDoEstagio, horaAtualBRT, type EstagioDunning,
} from '@/lib/dunning-engine'
import { TEXTOS_DUNNING, preencher } from '@/lib/dunning-content'
import { signPaymentLinkToken } from '@/lib/payment-link-token'

/**
 * GET /api/cron/dunning — a régua de cobrança (D-01).
 *
 * Roda DE HORA EM HORA e só age na janela de cada estágio (rotação 9h/12h/17h, D+4 fixo de
 * manhã). O motor (`lib/dunning-engine.ts`) decide; este arquivo apenas entrega.
 *
 * ⚠️ A ORDEM AQUI É O CONTRATO. As checagens acontecem UMA vez, no motor, ANTES de qualquer
 * canal — e-mail e WhatsApp saem juntos ou não saem. Foi a instrução explícita do Sidney:
 * "tudo que ocorre de checagem com os e-mails antes do envio tem que ocorrer nas mensagens
 * também". Se um dia alguém adicionar um terceiro canal, ele herda as checagens de graça; o
 * erro a evitar é ler o estado dentro de cada canal.
 *
 * NADA é agendado com antecedência: a cada rodada o estado é relido do banco e do gateway. É
 * assim que "pagou no meio da régua" interrompe os avisos sem ninguém cancelar nada.
 */
export async function GET(req: NextRequest) {
  if (!isValidBearerSecret(req.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    logError('[cron/dunning] service-role ausente')
    return NextResponse.json({ error: 'Config indisponível' }, { status: 503 })
  }
  const db = createServiceClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  // Hora de Brasília pelo fuso EXPLÍCITO (ver horaAtualBRT). `?hora=` só existe para conferir
  // uma janela específica à mão em homologação — não muda nada do que é enviado, só QUANDO.
  // ⚠️ `Number(null)` é 0 (não NaN): sem o guard de presença, TODA chamada sem `?hora=`
  // forçava horaBRT=0 → nenhum estágio dispara à 0h → régua muda de silenciosa p/ MUDA.
  // (Pego no disparo de validação de 13/08 — horaBRT:0 às 19h42 BRT.)
  const horaParam = new URL(req.url).searchParams.get('hora')
  const horaForcada = horaParam === null || horaParam === '' ? NaN : Number(horaParam)
  const horaBRT = Number.isInteger(horaForcada) && horaForcada >= 0 && horaForcada <= 23
    ? horaForcada
    : horaAtualBRT()

  // Candidatos: quem tem assinatura vinculada e NÃO está no gratuito, mais quem caiu para o
  // gratuito recentemente (o estágio 5 precisa deles). O motor filtra o resto.
  const { data: candidatos, error } = await db
    .from('profiles')
    .select('id, email, full_name, phone, plan, plan_status, plan_cycle, asaas_subscription_id')
    .not('asaas_subscription_id', 'is', null)
    .limit(500)

  if (error) {
    logError('[cron/dunning] query de candidatos falhou', error)
    return NextResponse.json({ error: 'query falhou' }, { status: 500 })
  }

  const r = { candidatos: candidatos?.length ?? 0, avisados: 0, silenciados: 0, alertasRebaixamento: 0, falhas: 0 }

  for (const bruto of candidatos ?? []) {
    const p = bruto as {
      id: string; email: string | null; full_name: string | null; phone: string | null
      plan: string | null; plan_status: string | null; plan_cycle: string | null
      asaas_subscription_id: string
    }
    try {
      // ── ESTADO ATUAL, lido AGORA (o gatilho de parada mora aqui) ─────────────────────────
      const due = await hasOverduePaymentForSubscription(p.asaas_subscription_id)
      const estado = {
        plano: p.plan,
        planStatus: p.plan_status,
        temVencida: due.ok ? due.overdue : null,
        vencidaDesde: due.oldestDueDate,
      }

      // O expire-plans não rebaixou quem devia? Ele não tem alarme próprio (verificado em
      // 11/08). A régua roda horas depois dele, então é a testemunha natural — avisa, nunca age.
      if (detectarRebaixamentoAtrasado(estado)) {
        r.alertasRebaixamento++
        await sendBillingOpsAlert({
          subject: '🔴 Rebaixamento ATRASADO: passou do prazo e a conta segue paga',
          lines: {
            'O QUE ISSO SIGNIFICA': 'O expire-plans deveria ter rebaixado esta conta e não rebaixou — verificar se o cron está rodando.',
            profileId: p.id, cliente: p.email, plano: p.plan,
            vencidaDesde: due.oldestDueDate, assinatura: p.asaas_subscription_id,
          },
        }).catch(() => {})
      }

      const decisao = decidirAviso(estado)
      if (!decisao.avisar || !ehHoraDoEstagio(decisao.estagio, horaBRT)) {
        r.silenciados++
        continue
      }

      // ── IDEMPOTÊNCIA DO DIA: um aviso por estágio, por cliente, por dia ──────────────────
      // O marcador usa a tabela de eventos (event_id UNIQUE), mesmo padrão dos markers de
      // billing: INSERT duplicado = já avisou hoje. Sem isto, um retry do cron mandaria a
      // mesma cobrança duas vezes — e cobrança repetida queima a relação.
      const dia = new Date().toISOString().slice(0, 10)
      const marcador = `dunning:${p.id}:${decisao.estagio}:${dia}`
      const { error: mkErr } = await db
        .from('asaas_webhook_events')
        .insert({ event_id: marcador, event: 'DUNNING_SENT', status: 'processed' })
      if (mkErr) {
        r.silenciados++
        continue // já avisado hoje
      }

      // ── ENTREGA — os dois canais, DEPOIS de todas as checagens ───────────────────────────
      const texto = TEXTOS_DUNNING[decisao.estagio]
      const dados = {
        nome: (p.full_name ?? '').trim().split(/\s+/)[0] || 'tudo bem',
        plano: planLabel(p.plan, p.plan_cycle),
      }
      // O botão aponta para a NOSSA rota /pagar/<token>, que redireciona para a cobrança. Dois
      // ganhos: o cliente nunca vê o nome do gateway (exigência do Sidney — ele comprou do
      // Instituto Eidos), e o template do WhatsApp fica aprovado para sempre, porque o destino
      // vira código nosso em vez de conteúdo submetido à Meta.
      //
      // Confere ANTES se existe cobrança com link: mandar para /pagar sabendo que não há fatura
      // faria o cliente clicar e cair no painel — parece que o botão quebrou. Sem link, o e-mail
      // troca o botão por "responda este e-mail".
      const link = await getLinkPagamentoVencido(p.asaas_subscription_id)
      const tokenPagamento = link.url ? signPaymentLinkToken(p.id) : null
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eidosform.com.br'
      const ctaUrl = tokenPagamento ? `${appUrl}/pagar/${tokenPagamento}` : null

      if (p.email) {
        await sendDunningEmail({
          to: p.email,
          assunto: preencher(texto.assunto, dados),
          paragrafos: texto.paragrafos.map((par) => preencher(par, dados)),
          ctaLabel: texto.ctaLabel,
          ctaUrl,
        }).catch((e) => logWarn('[cron/dunning] e-mail falhou (WhatsApp segue)', { profileId: p.id, err: String(e).slice(0, 120) }))
      }

      // WhatsApp: 2ª onda. Os templates estão redigidos em `dunning-content.ts` e aguardam
      // aprovação da Meta; enquanto não existirem, o envio devolve send_failed e some no log —
      // por isso o canal fica atrás desta flag, para não poluir com falha esperada.
      if (process.env.DUNNING_WHATSAPP_ENABLED === 'true' && p.phone) {
        const { sendConfirmationTemplate } = await import('@/lib/whatsapp-confirmations')
        await sendConfirmationTemplate({
          toPhone: p.phone,
          template: texto.whatsappTemplate,
          bodyParams: [dados.nome, dados.plano],
          context: `dunning:${decisao.estagio}:${p.id}`,
        }).catch(() => {})
      }

      r.avisados++
      log('[cron/dunning] aviso entregue', {
        profileId: p.id, estagio: decisao.estagio, diasRestantes: decisao.diasRestantes, comLink: Boolean(ctaUrl),
      })
    } catch (err) {
      r.falhas++
      logError('[cron/dunning] falha ao processar candidato (os demais seguem)', err, { profileId: p.id })
    }
  }

  if (r.avisados > 0 || r.alertasRebaixamento > 0) log('[cron/dunning] concluído', r)
  return NextResponse.json({ ok: true, horaBRT, ...r })
}
