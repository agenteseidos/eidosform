/**
 * lib/plan-limits.ts — Sistema de limites por plano
 * Single source of truth for plan pricing, features, and limits.
 */

import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { sendLimitAlert } from '@/lib/resend'
import { logError } from '@/lib/logger'
import { getEffectivePlan } from '@/lib/plans'
import {
  getPlanLimits,
  PLAN_LIMITS,
  PLANS,
  type PlanConfig,
  type PlanLimits,
  type PlanName,
} from '@/lib/plan-definitions'

export { getPlanLimits, PLAN_LIMITS, PLANS }
export type { PlanConfig, PlanLimits, PlanName }

/**
 * Alerta de 80% do limite de respostas — vendido como feature Plus+ na LP.
 *
 * Substituiu a antiga checkResponseLimit, que era código MORTO (nunca chamada;
 * auditoria LP 2026-07-28): o caminho real de submissão é a RPC atômica
 * check_and_increment_response, que já calcula near_limit com dedupe via
 * limit_alert_sent (marca a flag na própria RPC — aqui não há corrida).
 * Este helper só decide o gate de plano e envia o email. Fire-and-forget:
 * falha de email nunca bloqueia a submissão.
 */
export async function sendNearLimitAlert(
  userId: string,
  usage: number,
  limit: number,
  plan: PlanName
): Promise<void> {
  // ── O ALERTA VALE PARA TODOS OS PLANOS (alinhamento Free, item 6) ─────────────────────────
  //
  // Era restrito a Plus+. Duas razões para abrir:
  //
  // 1. QUEM MAIS PRECISA É QUEM MENOS TEM. O Free tem 100 respostas/mês — bate no teto muito mais
  //    rápido que um Plus com 5.000. E hoje ele descobre pelo pior caminho possível: um cliente
  //    reclamando que o formulário deu erro.
  // 2. É O E-MAIL DE VENDA MAIS BEM CRONOMETRADO QUE EXISTE. Chega exatamente quando a pessoa
  //    está tendo resultado e quase esbarrando no limite. Não é custo, é o gatilho de upgrade.
  //
  // 🐞 E fecha um bug feio junto: a RPC marca `limit_alert_sent = true` ao cruzar os 80%
  // INDEPENDENTEMENTE de o e-mail ter saído. Com o gate aqui, free/starter queimavam a marca sem
  // receber nada — e quem fizesse upgrade no meio do período também perdia o aviso, porque a marca
  // já estava consumida. Sem gate, a marca e o envio voltam a andar juntos.
  //
  // A marca é zerada na virada do período pela própria RPC, então o aviso volta todo mês.

  const supabase = createServiceRoleClient()
  const { data: userData } = await supabase
    .from('profiles')
    .select('email, full_name')
    .eq('id', userId)
    .single()

  if (userData?.email) {
    await sendLimitAlert({
      to: userData.email,
      name: userData.full_name ?? 'usuário',
      usage,
      limit,
      plan,
    }).catch((err) => logError('Failed to send limit alert', err))
  }
}

export async function incrementResponseCount(userId: string): Promise<void> {
  const supabase = createServiceRoleClient()
  await supabase.rpc('increment_responses_used', { p_user_id: userId })
}

export async function checkAndIncrementResponseCount(userId: string, responseId: string): Promise<{
  allowed: boolean
  usage: number
  limit: number
  plan: PlanName
  nearLimit: boolean
  alreadyCounted: boolean
  unavailable: boolean
}> {
  const supabase = createServiceRoleClient()

  try {
    const { data, error } = await supabase
      .rpc('check_and_increment_response', { p_user_id: userId, p_response_id: responseId })
      .single() as {
        data: {
          allowed: boolean
          usage: number
          limit_val: number
          plan: PlanName
          near_limit: boolean
          already_counted: boolean
        } | null
        error: unknown
      }

    if (error || !data) {
      logError('checkAndIncrementResponseCount: RPC failed, fail-closed', error, { userId, responseId })
      return { allowed: false, usage: 0, limit: 0, plan: 'free', nearLimit: false, alreadyCounted: false, unavailable: true }
    }

    return {
      allowed: data.allowed,
      usage: data.usage,
      limit: data.limit_val,
      plan: data.plan ?? 'free',
      nearLimit: data.near_limit,
      alreadyCounted: data.already_counted,
      unavailable: false,
    }
  } catch (err) {
    logError('checkAndIncrementResponseCount: threw, fail-closed', err, { userId, responseId })
    return { allowed: false, usage: 0, limit: 0, plan: 'free', nearLimit: false, alreadyCounted: false, unavailable: true }
  }
}

export async function checkFormLimit(userId: string): Promise<{ allowed: boolean; usage: number; limit: number }> {
  const supabase = await createClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at, plan_status, asaas_subscription_id')
    .eq('id', userId)
    .single()

  const plan = getEffectivePlan(profile) as PlanName
  const limits = getPlanLimits(plan)

  if (limits.maxForms === -1) return { allowed: true, usage: 0, limit: -1 }

  const { count } = await supabase
    .from('forms')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  const usage = count ?? 0
  return { allowed: usage < limits.maxForms, usage, limit: limits.maxForms }
}

/**
 * Handle plan downgrade — pause forms above free tier limit
 *
 * When a user's plan expires or is cancelled:
 * 1. Unpause ALL forms first (clean slate)
 * 2. Get published forms with their response counts
 * 3. Keep the 3 forms with FEWEST responses active
 * 4. Forms with 100+ responses are NEVER kept active → always paused
 * 5. Pause all remaining forms
 *
 * Tie-breaking: random among forms with equal response counts.
 * Uses service role client to bypass RLS during webhook processing.
 */
/**
 * Seleciona quais formulários ficam ATIVOS quando a conta está num plano com teto (free/starter).
 * Função PURA — testável sem banco.
 *
 * Regra (alinhamento Free, decisões 1/2/4 de 2026-08):
 *  1. Os formulários competem pelas `formLimit` vagas por VOLUME de respostas — sobrevivem os
 *     MENOS usados (decisão do Sidney: os mais usados caem primeiro). NÃO existe mais a "peneira
 *     dos 100+" (formulário com 100+ respostas na vida era pausado para sempre) — ela comparava
 *     total histórico com cota mensal, coisas diferentes, e podia zerar a conta inteira.
 *  2. Um formulário que GANHOU vaga mas tem mais perguntas que o teto do plano fica PAUSADO — sem
 *     liberar a vaga para outro. O dono reduz as perguntas e ele reativa (a edição continua
 *     permitida; ver PATCH). Assim o rebaixado alcança exatamente o mesmo estado de quem sempre
 *     foi Free.
 *
 * Empate de contagem: ordem aleatória justa (rng injetável só para teste).
 */
export type FormSelectionMeta = { id: string; responseCount: number; questionCount: number }

export function selectActiveForms(
  forms: FormSelectionMeta[],
  formLimit: number,
  maxQuestions: number,
  rng: () => number = () => {
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    return buf[0] / 2 ** 32
  }
): { activeIds: string[]; pausedIds: string[] } {
  // Plano ilimitado (Plus/Professional, maxForms=-1): nada é pausado.
  if (formLimit < 0) {
    return { activeIds: forms.map((f) => f.id), pausedIds: [] }
  }

  // Chave aleatória estável por formulário desempata sem depender da ordem de chegada.
  const ordered = forms
    .map((f) => ({ f, key: rng() }))
    .sort((a, b) => a.f.responseCount - b.f.responseCount || a.key - b.key)
    .map((x) => x.f)

  const slotWinners = ordered.slice(0, formLimit)
  const activeIds: string[] = []
  const pausedIds: string[] = []

  const winnerSet = new Set(slotWinners.map((f) => f.id))
  for (const f of ordered) {
    // Ativo = ganhou vaga E cabe no teto de perguntas. O resto pausa.
    if (winnerSet.has(f.id) && f.questionCount <= maxQuestions) activeIds.push(f.id)
    else pausedIds.push(f.id)
  }
  return { activeIds, pausedIds }
}

/**
 * Reavalia e persiste o estado `paused` de TODOS os formulários publicados do dono, nos dois
 * sentidos (despausa quem passou a caber, pausa quem não cabe mais).
 *
 * Chamado no downgrade (estado inicial), ao APAGAR formulário (libera vaga — decisão 4) e ao
 * SALVAR formulário (reduzir perguntas reativa — decisão 2). Idempotente.
 *
 * ⚠️ Carrega `questions` dos formulários publicados para contar o tamanho. É O(formulários) em
 * memória, mas só roda para planos com teto (free/starter), cujos donos têm poucos formulários, e
 * fora do caminho quente de resposta. Se algum dia um Starter com 100 formulários pesar aqui, o
 * caminho certo é uma RPC de contagem de perguntas (como já existe para respostas).
 */
export async function recomputeActiveForms(
  serviceRoleKey: string,
  userId: string,
  targetPlan: PlanName
): Promise<{ pausedCount: number }> {
  const supabase = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey)
  const formLimit = PLANS[targetPlan]?.maxForms ?? PLANS.free.maxForms
  const maxQuestions = PLANS[targetPlan]?.maxQuestions ?? PLANS.free.maxQuestions

  // Plano ilimitado: garante que nada fique preso pausado e sai.
  if (formLimit < 0) {
    const { error } = await supabase.from('forms').update({ paused: false }).eq('user_id', userId).eq('paused', true)
    if (error) throw new Error(`recomputeActiveForms: falha ao despausar (plano ilimitado): ${error.message}`)
    return { pausedCount: 0 }
  }

  const { data: published, error: pubErr } = await supabase
    .from('forms')
    .select('id, questions')
    .eq('user_id', userId)
    .eq('status', 'published')
  if (pubErr) throw new Error(`recomputeActiveForms: falha ao listar publicados: ${pubErr.message}`)
  if (!published || published.length === 0) return { pausedCount: 0 }

  const formIds = published.map((f: { id: string }) => f.id)
  const { data: responseCounts, error: rpcErr } = await supabase
    .rpc('get_response_counts_by_forms', { p_form_ids: formIds }) as { data: Array<{ form_id: string; response_count: number }> | null; error: { message?: string } | null }
  if (rpcErr) throw new Error(`recomputeActiveForms: falha na RPC de contagem: ${rpcErr.message ?? 'erro'}`)

  const countMap = new Map<string, number>(formIds.map((id: string) => [id, 0]))
  for (const r of responseCounts ?? []) countMap.set(r.form_id, r.response_count)

  const meta: FormSelectionMeta[] = published.map((f: { id: string; questions?: unknown }) => ({
    id: f.id,
    responseCount: countMap.get(f.id) ?? 0,
    questionCount: Array.isArray(f.questions) ? f.questions.length : 0,
  }))

  const { activeIds, pausedIds } = selectActiveForms(meta, formLimit, maxQuestions)

  // Aplica nos dois sentidos, cada um só onde muda de estado.
  if (activeIds.length > 0) {
    const { error } = await supabase.from('forms').update({ paused: false }).in('id', activeIds).eq('paused', true)
    if (error) throw new Error(`recomputeActiveForms: falha ao despausar ativos: ${error.message}`)
  }
  if (pausedIds.length > 0) {
    const { error } = await supabase.from('forms').update({ paused: true }).in('id', pausedIds).eq('paused', false)
    if (error) {
      logError('[recomputeActiveForms] Failed to pause forms', error)
      throw new Error(`recomputeActiveForms: falha ao pausar: ${error.message ?? String(error)}`)
    }
  }
  return { pausedCount: pausedIds.length }
}

export async function handleDowngrade(
  userId: string,
  serviceRoleKey: string,
  // TARGET-AWARE (P1, audit Codex 2026-06-08): o limite de forms é o do PLANO-ALVO, não fixo em
  // free(3). Plus/Professional são ilimitados (-1) → não pausa nada; Starter(100); free(3).
  targetPlan: PlanName = 'free'
): Promise<{ pausedCount: number }> {
  // Delega ao motor único (alinhamento Free, 2026-08). Antes esta função tinha a seleção inteira
  // embutida e mais ninguém sabia recalcular — por isso apagar formulário nunca devolvia a vaga.
  //
  // O QUE MUDOU AQUI, e por quê:
  //  · A "peneira dos 100+" SUMIU. Ela pausava para sempre qualquer formulário com 100+ respostas
  //    na VIDA, comparando um total histórico com a cota MENSAL da conta — grandezas diferentes.
  //    Quem sempre foi Free nunca passa por ela (só roda em quem MUDA de plano) e pode acumular
  //    milhares de respostas com o formulário no ar. Pior: se todos os formulários do dono
  //    passassem de 100, ele ficava com ZERO ativos, e não havia ação nenhuma capaz de reverter.
  //  · O teto de PERGUNTAS passou a valer: formulário com mais perguntas que o plano permite fica
  //    pausado (o dono reduz e ele volta — a edição continua liberada no PATCH).
  //  · Some o "unpause de tudo primeiro". Ele deixava TODOS os formulários no ar por um instante
  //    entre as duas escritas; agora cada um só é tocado se de fato mudar de estado.
  return recomputeActiveForms(serviceRoleKey, userId, targetPlan)
}

/**
 * Handle plan upgrade — unpause all forms
 *
 * When a user upgrades/reactivates their plan, unpause all forms.
 */
export async function handleUpgrade(
  userId: string,
  serviceRoleKey: string
): Promise<{ unpausedCount: number }> {
  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey
  )

  const { data: pausedForms, error: selErr } = await supabase
    .from('forms')
    .select('id')
    .eq('user_id', userId)
    .eq('paused', true)
  // #2 (audit 2026-06-08): LANÇA em falha — antes o erro era silencioso e os forms ficavam
  // pausados num plano pago. Com o throw, o webhook vai pra DLQ e o reprocessador completa.
  if (selErr) throw new Error(`handleUpgrade: falha ao listar forms pausados: ${selErr.message}`)

  if (!pausedForms || pausedForms.length === 0) {
    return { unpausedCount: 0 }
  }

  const { error: updErr } = await supabase
    .from('forms')
    .update({ paused: false })
    .eq('user_id', userId)
    .eq('paused', true)
  if (updErr) throw new Error(`handleUpgrade: falha ao despausar forms: ${updErr.message}`)

  return { unpausedCount: pausedForms.length }
}

/**
 * Count paused forms for a user
 */
export async function countPausedForms(userId: string): Promise<number> {
  const supabase = createServiceRoleClient()

  const { count } = await supabase
    .from('forms')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('paused', true)

  return count ?? 0
}
