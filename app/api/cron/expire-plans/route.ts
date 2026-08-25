import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getSubscription, hasOverduePaymentForSubscription } from '@/lib/asaas'
import { PLANS, handleDowngrade, recomputeActiveForms, type PlanName } from '@/lib/plan-limits'
import { expiryFromNextDueDate, calculateExpiryDate, type BillingCycle } from '@/lib/billing-activation'
import { computeProrationBasisDays } from '@/lib/proration'
import { log, logError, logWarn } from '@/lib/logger'
import { buildResponseQuotaPeriodReset } from '@/lib/response-quota'
import { isValidBearerSecret } from '@/lib/bearer-auth'
import { sendBillingOpsAlert } from '@/lib/resend'
import { PRAZO_DIAS, diasDesde } from '@/lib/dunning-engine'

/**
 * GET /api/cron/expire-plans — CRON diário (Vercel).
 *
 * Reversão PERSISTIDA de planos expirados. Antes, a reversão (plano→free + pausar forms via
 * handleDowngrade) só rodava quando o usuário abria o dashboard (/api/user/plan-features) — um
 * churned que nunca mais logava deixava o DB divergente e forms não-pausados pra sempre.
 * (#2, audit 2026-06-08.) Protegido por CRON_SECRET (Vercel envia Authorization: Bearer <secret>).
 *
 * Lógica por profile expirado (plan != free AND plan_expires_at < now):
 *  - tem sub vinculada e ela está ACTIVE no Asaas → renovação atrasada: ESTENDE a expiração
 *    (nextDueDate real, fim-de-dia BRT; fallback now+ciclo). Não derruba pagante.
 *  - sub 404/não-ACTIVE, ou sem sub → REVERTE p/ free + handleDowngrade (pausa forms).
 *  - erro transitório ao consultar o Asaas → conservador: NÃO reverte agora (próximo tick).
 *  - sub ACTIVE mas com cobrança OVERDUE → só estende se estiver DENTRO da carência; passou
 *    de OVERDUE_GRACE_DAYS, REVERTE. (auditoria 2026-08, lote 1D.)
 */

/**
 * Dias de tolerância após o vencimento antes de rebaixar. Decisão do Sidney (06/08): 5 dias.
 * Motivo: o Asaas retenta o cartão nos dias seguintes ao vencimento; derrubar no dia 1 pausaria
 * os formulários de um cliente que ia pagar. Acima disso, é acesso pago sem receita.
 */
// FONTE ÚNICA (auditoria 25/08/2026). Este número e o `PRAZO_DIAS` da régua de cobrança eram
// duas constantes independentes com o mesmo valor, e o teste que dizia guardar o alinhamento só
// verificava `PRAZO_DIAS === 5` — nunca importava esta. Passaria intacto se alguém mudasse a
// carência aqui para 30 dias, e a régua passaria a prometer um prazo que o rebaixamento não
// honra. Agora divergir é impossível: é a MESMA constante, e o mesmo `diasDesde`.
const OVERDUE_GRACE_DAYS = PRAZO_DIAS

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  // D10 (lote 2-bis): comparação em tempo constante, via fonte única.
  if (!isValidBearerSecret(req.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    logError('[cron/expire-plans] SUPABASE service-role env ausente')
    return NextResponse.json({ error: 'Config indisponível' }, { status: 503 })
  }
  const admin = createServiceClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  const nowIso = new Date().toISOString()
  const { data: expired, error } = await admin
    .from('profiles')
    .select('id, plan, plan_status, plan_cycle, plan_expires_at, asaas_subscription_id')
    .neq('plan', 'free')
    .lt('plan_expires_at', nowIso)
    .limit(500)

  if (error) {
    logError('[cron/expire-plans] query de expirados falhou', error)
    return NextResponse.json({ error: 'query falhou' }, { status: 500 })
  }

  let reverted = 0
  let extended = 0
  // DESFECHOS DETALHADOS (auditoria 25/08/2026). `skipped` sozinho não distingue "adiei de
  // propósito" de "tentei escrever e falhou" — e os DOIS ramos de erro de escrita (extErr,
  // revErr) não incrementavam NADA, então `total` podia ser MAIOR que a soma dos contadores
  // justamente nos casos em que o banco fica inconsistente (forms pausados + plano ainda pago).
  // No plano Hobby esta resposta JSON é a única evidência que sobrevive: ela não pode mentir
  // por omissão. Agora cada perfil cai em EXATAMENTE UM desfecho e vale a identidade:
  //   total === reverted + extended + grace + transient + writeFailed + conflict
  let grace = 0        // dentro da carência: decisão adiada de propósito (esperado)
  let transient = 0    // falha de rede/consulta: decisão adiada por precaução (não esperado)
  let writeFailed = 0  // a escrita foi TENTADA e falhou → pode haver estado inconsistente
  let conflict = 0     // CAS perdeu a corrida: outro caminho alterou o perfil (esperado, raro)

  for (const row of expired ?? []) {
    const p = row as { id: string; plan: string | null; plan_status: string | null; plan_cycle: string | null; plan_expires_at: string | null; asaas_subscription_id: string | null }
    let shouldRevert = true
    let rebaixamentoPorInadimplencia = false

    if (p.asaas_subscription_id) {
      try {
        const sub = (await getSubscription(p.asaas_subscription_id)) as { status?: string; nextDueDate?: string }
        if (String(sub?.status ?? '').toUpperCase() === 'ACTIVE') {
          // PROVA DE PAGAMENTO antes de estender (auditoria 2026-08, lote 1D).
          // No Asaas o status da SUB é independente do status da COBRANÇA: cartão recusado
          // mantém `ACTIVE` emitindo faturas OVERDUE. Sem esta checagem, o período pago já
          // terminou (a linha só chega aqui com plan_expires_at vencido) e mesmo assim o
          // acesso era empurrado +1 ciclo A CADA EXECUÇÃO DIÁRIA — acesso pago vitalício
          // sem receita. O cron irmão (reconcile-checkouts) já exigia prova de dinheiro.
          const due = await hasOverduePaymentForSubscription(p.asaas_subscription_id)
          if (!due.ok) {
            // Consulta falhou → conservador: não estende E não derruba (mesma postura do
            // catch de erro transitório abaixo). Reavalia no próximo tick.
            shouldRevert = false
            transient++
            logWarn('[cron/expire-plans] consulta de OVERDUE falhou — adia decisão', { profileId: p.id })
            continue
          }
          if (due.overdue) {
            // CARÊNCIA DE 5 DIAS (decisão Sidney, 06/08). O Asaas ainda retenta o cartão nos
            // dias seguintes ao vencimento; derrubar no primeiro dia pausaria os formulários de
            // um cliente que ia pagar. Dentro da carência: NÃO estende e NÃO derruba — fica
            // parado até a fatura ser paga (aí volta ao ramo de renovação) ou a carência vencer.
            // ⚠️ A carência é SILENCIOSA hoje: o cliente não é avisado do atraso nem do
            // rebaixamento iminente. A régua de cobrança (e-mail + WhatsApp) está registrada em
            // `docs/demandas-futuras.md` como D-01 — sem ela, o cliente descobre pelo produto.
            const diasVencido = diasDesde(due.oldestDueDate)
            if (diasVencido !== null && diasVencido < OVERDUE_GRACE_DAYS) {
              shouldRevert = false
              grace++
              logWarn('[cron/expire-plans] cobrança VENCIDA dentro da carência — aguarda', {
                profileId: p.id, subscriptionId: p.asaas_subscription_id,
                oldestDueDate: due.oldestDueDate, diasVencido, carenciaDias: OVERDUE_GRACE_DAYS,
              })
              continue
            }
            // Fora da carência (ou data de vencimento ilegível → trata como fora, conservador
            // quanto à RECEITA: não conceder acesso indefinido por falta de dado).
            // `shouldRevert` continua true → cai na reversão normal lá embaixo (que pausa os
            // formulários primeiro e só então marca free). NÃO usar `throw` aqui: o catch
            // abaixo trata exceção como erro TRANSITÓRIO e faria justamente o contrário,
            // adiando a reversão para sempre.
            logWarn('[cron/expire-plans] cobrança VENCIDA além da carência — rebaixa', {
              profileId: p.id, subscriptionId: p.asaas_subscription_id,
              oldestDueDate: due.oldestDueDate, diasVencido, carenciaDias: OVERDUE_GRACE_DAYS,
            })
            rebaixamentoPorInadimplencia = true
          } else {
          // Renovação atrasada — estende em vez de derrubar o pagante. Recomputa TAMBÉM a
          // régua de valoração (§4.F): este é o fallback do webhook-fora-do-ar; sem recomputar,
          // o divisor VELHO persistiria e a distorção que o projeto mata reapareceria. Sem
          // paymentDueDate → a base é derivada do nextDueDate por mês/ano-CALENDÁRIO (§2.5);
          // fora de banda / inválido → null → NÃO grava (fica no valor vigente/fallback + log).
          const cycleRenew = (p.plan_cycle ?? 'MONTHLY') as BillingCycle
          const next = expiryFromNextDueDate(sub?.nextDueDate) ?? calculateExpiryDate(cycleRenew)
          const basisRenew = computeProrationBasisDays(cycleRenew, sub?.nextDueDate)
          const upd: Record<string, unknown> = { plan_expires_at: next }
          if (basisRenew !== null) {
            upd.proration_basis_days = basisRenew
            upd.billing_period_end_on = sub?.nextDueDate ?? null
          }
          // ESCRITA CONDICIONAL (CAS — achado da varredura 10/08/2026): entre a foto do começo
          // e esta linha passaram-se chamadas de rede ao Asaas — num lote de 500, MINUTOS. Se o
          // webhook processou um upgrade nesse meio-tempo, `plan_expires_at` mudou; estender por
          // cima esmagaria a expiração do plano NOVO com a data da assinatura VELHA. Os `.eq`
          // extras dizem: só grave se o estado ainda for exatamente o que eu li.
          const { data: extRows, error: extErr } = await admin.from('profiles').update(upd)
            .eq('id', p.id)
            .eq('plan', p.plan)
            .eq('plan_expires_at', p.plan_expires_at)
            .select('id')
          if (extErr) {
            // Antes NÃO incrementava contador nenhum — a resposta JSON escondia a falha.
            writeFailed++
            logError('[cron/expire-plans] falha ao estender', extErr, { profileId: p.id })
          }
          else if (!extRows || extRows.length === 0) {
            conflict++
            logWarn('[cron/expire-plans] extensão PERDEU A CORRIDA (estado mudou sob o cron) — não gravei', { profileId: p.id })
          } else extended++
          shouldRevert = false
          }
        }
        // status != ACTIVE → reverte abaixo
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!/error 404/i.test(msg)) {
          // transitório → não reverte agora (não derruba pagante por falha de rede)
          shouldRevert = false
          transient++
          logWarn('[cron/expire-plans] Asaas transitório — adia reversão', { profileId: p.id, error: msg })
        }
        // 404 → sub não existe mais → reverte abaixo
      }
    }

    if (shouldRevert) {
      try {
        // #1: PAUSA OS FORMS PRIMEIRO (handleDowngrade lança se falhar). Só DEPOIS marca free.
        // Se o downgrade falhar, NÃO marca free → o profile segue 'pago/expirado' e o próximo
        // tick do cron retenta (não some da query). Evita "free mas forms nunca pausados".
        await handleDowngrade(p.id, key)
        // ESCRITA CONDICIONAL (CAS — o gêmeo mais perigoso do da extensão acima): o cenário que
        // este `.eq` extra mata é o cliente PAGANDO no meio da execução do cron. A foto do
        // começo o lista como expirado; o webhook ativa o plano; e esta linha, sem a guarda,
        // escreveria `free` por cima da ativação — cliente pagou e foi rebaixado segundos
        // depois, sem aviso. Com a guarda, qualquer pagamento/upgrade muda `plan_expires_at`
        // e a reversão erra o alvo de propósito (0 linhas).
        const { data: revRows, error: revErr } = await admin
          .from('profiles')
          .update({
            plan: 'free',
            // Usuário que CANCELOU e chegou ao fim do período termina como 'cancelled'
            // (não 'expired') — preserva a semântica/métrica de churn. (P3, audit 2026-06-09.)
            plan_status: p.plan_status === 'canceling' ? 'cancelled' : 'expired',
            plan_expires_at: null,
            asaas_subscription_id: null,
            // Ao cortar por inadimplência, preserva a assinatura e o plano que originaram a
            // dívida. Sem esse snapshot, o D+5 fica inalcançável e links antigos de /pagar
            // passam a responder "sem pendência" assim que o vínculo ativo é apagado.
            ...(rebaixamentoPorInadimplencia ? {
              overdue_subscription_id: p.asaas_subscription_id,
              previous_plan: p.plan,
              previous_plan_cycle: p.plan_cycle,
              downgraded_at: new Date().toISOString(),
            } : {}),
            annual_started_at: null,
            // free LIMPA a régua de valoração (caso 5) — este revert NÃO usa buildFreePlanUpdate.
            proration_basis_days: null,
            billing_period_start_on: null,
            billing_period_end_on: null,
            limit_alert_sent: false,
            responses_limit: PLANS.free.maxResponses,
            ...buildResponseQuotaPeriodReset(),
          })
          .eq('id', p.id)
          .eq('plan', p.plan)
          .eq('plan_expires_at', p.plan_expires_at)
          .select('id')
        if (revErr) {
          // ⚠️ ESTADO INCONSISTENTE: handleDowngrade JÁ recompôs os formulários pelas regras do
          // free e a marcação do plano falhou — o perfil segue PAGO com os formulários já
          // recompostos como free. Antes isto não incrementava contador nenhum e só ia para o
          // console (inalcançável no Hobby). Agora conta como writeFailed e a rota alerta no
          // fim da execução. A cura é a mesma da corrida perdida: recompor os formulários pelo
          // plano REALMENTE persistido, para não deixar pausado quem continua pagante.
          writeFailed++
          logError('[cron/expire-plans] forms recompostos mas falha ao marcar free (retenta no próximo tick)', revErr, { profileId: p.id })
          try {
            const { data: atual } = await admin.from('profiles').select('plan').eq('id', p.id).single()
            const planoAtual = ((atual as { plan?: string | null } | null)?.plan ?? 'free') as PlanName
            await recomputeActiveForms(key, p.id, planoAtual)
          } catch (healErr) {
            logError('[cron/expire-plans] cura pós-falha-de-escrita falhou — formulários podem estar pausados indevidamente', healErr, { profileId: p.id })
          }
        } else if (!revRows || revRows.length === 0) {
          // Perdeu a corrida DEPOIS de pausar os formulários — o handleDowngrade acima já os
          // pausou pelas regras do free, mas o dono acabou de pagar. CURA: relê o plano atual e
          // recompõe o que fica no ar pelas regras do plano VERDADEIRO. Sem isto, o cliente
          // pagaria e ficaria com os formulários pausados até alguém notar.
          conflict++
          logWarn('[cron/expire-plans] reversão PERDEU A CORRIDA (provável pagamento durante o cron) — curando os formulários', { profileId: p.id })
          try {
            const { data: atual } = await admin.from('profiles').select('plan').eq('id', p.id).single()
            const planoAtual = ((atual as { plan?: string | null } | null)?.plan ?? 'free') as PlanName
            await recomputeActiveForms(key, p.id, planoAtual)
          } catch (healErr) {
            logError('[cron/expire-plans] cura pós-corrida falhou — formulários podem estar pausados indevidamente', healErr, { profileId: p.id })
          }
        } else {
          reverted++
        }
      } catch (err) {
        // downgrade falhou (forms não pausados) → NÃO marca free → próximo tick retenta.
        writeFailed++
        logError('[cron/expire-plans] downgrade falhou; adiando reversão (retenta no próximo tick)', err, { profileId: p.id })
      }
    }
  }

  const total = expired?.length ?? 0
  const skipped = grace + transient + writeFailed + conflict
  // INVARIANTE: todo perfil da fila tem que ter caído em exatamente um desfecho. Se não fechar,
  // existe caminho novo sem contabilidade — o defeito que esta auditoria encontrou. Não derruba
  // a execução (o trabalho já foi feito); denuncia.
  const contabilizados = reverted + extended + skipped
  const desfechos = { grace, transient, writeFailed, conflict }

  // ALERTA DURÁVEL. `writeFailed` significa que a escrita foi TENTADA e falhou — o perfil pode
  // ter ficado inconsistente. No Hobby o console não sobrevive, então este é o único canal que
  // chega em alguém. (Antes: zero chamadas de alerta neste arquivo — era o único cron de
  // billing sem alarme próprio, e é o que decide dinheiro.)
  if (writeFailed > 0 || contabilizados !== total) {
    await sendBillingOpsAlert({
      subject: writeFailed > 0
        ? '🔴 expire-plans: falha de ESCRITA — perfil pode estar inconsistente'
        : '🟠 expire-plans: contabilidade não fecha',
      lines: {
        'O QUE ISSO SIGNIFICA': writeFailed > 0
          ? 'O cron tentou gravar o rebaixamento (ou a extensão) e o banco recusou. Os formulários podem já ter sido recompostos como free com o plano ainda pago. O próximo tick retenta.'
          : 'Algum perfil da fila não caiu em nenhum desfecho contabilizado — há caminho sem contador.',
        total: String(total), reverted: String(reverted), extended: String(extended),
        ...Object.fromEntries(Object.entries(desfechos).map(([k, v]) => [k, String(v)])),
        contabilizados: String(contabilizados),
      },
    }).catch((e) => logError('[cron/expire-plans] alerta de ops NÃO foi entregue', e))
  }

  log('[cron/expire-plans] concluído', { total, reverted, extended, skipped, ...desfechos })
  return NextResponse.json({ ok: true, total, reverted, extended, skipped, ...desfechos })
}
