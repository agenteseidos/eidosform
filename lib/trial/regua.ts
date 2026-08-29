/**
 * Régua do trial — envia D0, D+15, D+25 e D+30.
 *
 * A ordem dos passos é a proteção principal, e é assim porque a Cloud API NÃO tem idempotência:
 * reenviar o mesmo template gera OUTRA mensagem no celular da pessoa.
 *
 *   reservar (lease)  →  revalidar  →  reservar cota  →  SELAR  →  Meta  →  registrar
 *
 * Selar ANTES de chamar a Meta é o que impede duplicata: se o processo morre depois do envio, a
 * linha já está `sealed` e o worker nunca a reserva de novo (ele só pega `pending`). O preço é
 * poder desperdiçar uma etapa quando a selagem falha — desperdiçar é aceitável, duplicar não.
 *
 * Desfechos da Meta e o que fazemos com cada um:
 *   • aceitou            → `accepted` + WAMID.
 *   • recusou explicitamente → nada saiu, então é seguro tentar de novo (backoff).
 *   • não respondeu / timeout → `ambiguous`. NUNCA reenvia: pode ter saído. Alerta e olho humano.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { sendConfirmationTemplate, consultarOptOut } from '@/lib/whatsapp-confirmations'
import { log, logError, logWarn } from '@/lib/logger'

export type EtapaTrial = 'd0' | 'd15' | 'd25' | 'd30'

const LEASE_MS = 5 * 60_000
const MAX_TENTATIVAS = 3
/** Backoff por tentativa. Minutos, não dias: o D0 promete "na hora". */
const BACKOFF_MIN = [1, 5, 15, 60]

/**
 * Teto próprio da régua nas últimas 24h. O disparo de campanha tem o dele (120, contado na Elen).
 * Os dois são DISJUNTOS e somam 150 — por isso cada um pode contar o seu sem enxergar o outro:
 * no pior caso, 120 + 30 = 150, que é o limite. Fonte única só seria necessária se os tetos se
 * sobrepusessem.
 */
const TETO_REGUA_24H = 30

const TEMPLATE_POR_ETAPA: Record<EtapaTrial, string> = {
  d0: 'eidosform_conta_prazo_v1',
  d15: 'eidosform_conta_checkin_v1',
  d25: 'eidosform_conta_prazo_v1',
  d30: 'eidosform_conta_prazo_v1',
}

/** Texto do {{2}}. O esqueleto do template é neutro; o conteúdo da etapa entra por parâmetro. */
export function textoDaEtapa(etapa: EtapaTrial, expiraEm: Date): string {
  const dia = expiraEm.toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo',
  })
  switch (etapa) {
    case 'd0':
      return `seu acesso ao plano Plus foi ativado e vale até ${dia}. Pixels, CAPI e aviso do lead no WhatsApp já estão liberados nos seus formulários`
    case 'd15':
      return 'Seu acesso ao plano Plus está na metade do período. Você já ligou um formulário em alguma campanha?'
    case 'd25':
      return `seu acesso ao plano Plus vai até ${dia}. Depois disso, pixels, CAPI e aviso no WhatsApp param nos seus formulários, e os que passam do plano gratuito são pausados`
    case 'd30':
      return 'hoje é o último dia do seu acesso ao plano Plus. Sua conta e seus formulários continuam, mas amanhã voltam ao plano gratuito'
  }
}

type LinhaEntrega = {
  id: string
  phone_match_key_br: string
  stage: EtapaTrial
  valid_until: string
  attempts: number
}

export type ResultadoRegua = {
  examinadas: number
  enviadas: number
  puladas: number
  adiadas: number
  ambiguas: number
  mortas: number
  erros: number
}

export async function processarEntregasDevidas(
  db: SupabaseClient,
  opcoes: { limite?: number; agora?: Date } = {}
): Promise<ResultadoRegua> {
  const agora = opcoes.agora ?? new Date()
  const limite = opcoes.limite ?? 20
  const r: ResultadoRegua = { examinadas: 0, enviadas: 0, puladas: 0, adiadas: 0, ambiguas: 0, mortas: 0, erros: 0 }

  const { data: devidas, error } = await db
    .from('trial_deliveries')
    .select('id, phone_match_key_br, stage, valid_until, attempts')
    .eq('state', 'pending')
    .lte('due_at', agora.toISOString())
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${agora.toISOString()}`)
    .order('due_at', { ascending: true })
    .limit(limite)

  if (error) {
    logError('[trial/regua] consulta de entregas devidas falhou', error)
    r.erros++
    return r
  }

  // Cota é lida UMA vez por rodada e decrementada em memória: o worker é único, então não há
  // outro processo consumindo o mesmo teto no meio da rodada.
  let vagas = await vagasRestantes(db, agora)

  for (const linha of (devidas ?? []) as LinhaEntrega[]) {
    r.examinadas++
    if (vagas <= 0) { r.adiadas++; await adiar(db, linha, agora, 'cota_da_regua'); continue }

    const token = randomUUID()
    const { data: reservada } = await db
      .from('trial_deliveries')
      .update({ state: 'reserved', lease_token: token, lease_until: new Date(agora.getTime() + LEASE_MS).toISOString() })
      .eq('id', linha.id)
      .eq('state', 'pending')
      .select('id')
    if (!Array.isArray(reservada) || reservada.length === 0) continue // outro processo pegou

    try {
      const enviada = await processarUma(db, linha, token, agora)
      if (enviada === 'enviada') { r.enviadas++; vagas-- }
      else if (enviada === 'pulada') r.puladas++
      else if (enviada === 'adiada') r.adiadas++
      else if (enviada === 'ambigua') { r.ambiguas++; vagas-- }  // pode ter saído: consome a vaga
      else if (enviada === 'morta') r.mortas++
    } catch (err) {
      logError('[trial/regua] erro ao processar entrega', err, { entregaId: linha.id })
      r.erros++
      await adiar(db, linha, agora, 'excecao')
    }
  }

  return r
}

type Desfecho = 'enviada' | 'pulada' | 'adiada' | 'ambigua' | 'morta'

async function processarUma(
  db: SupabaseClient,
  linha: LinhaEntrega,
  token: string,
  agora: Date
): Promise<Desfecho> {
  // Etapa velha demais não é mais enviada: avisar "faltam 5 dias" com 3 dias de atraso é pior
  // que não avisar.
  if (new Date(linha.valid_until).getTime() <= agora.getTime()) {
    await pular(db, linha, 'etapa_vencida')
    return 'pulada'
  }

  const { data: ledger } = await db
    .from('plan_trials')
    .select('status, expires_at, profile_id')
    .eq('phone_match_key_br', linha.phone_match_key_br)
    .maybeSingle()

  if (!ledger || ledger.status !== 'ativo') {
    // Converteu (assinou), expirou ou lapsou: a régua não fala mais com essa pessoa.
    await pular(db, linha, `ledger_${ledger?.status ?? 'ausente'}`)
    return 'pulada'
  }
  if (ledger.expires_at && new Date(ledger.expires_at).getTime() <= agora.getTime()) {
    await pular(db, linha, 'trial_expirado')
    return 'pulada'
  }

  const { data: perfil } = await db
    .from('profiles')
    .select('full_name, phone')
    .eq('id', ledger.profile_id!)
    .maybeSingle()
  if (!perfil?.phone) {
    await pular(db, linha, 'sem_telefone')
    return 'pulada'
  }

  // Opt-out FAIL-CLOSED: 'desconhecido' (Elen fora do ar) adia. Mandar mensagem para quem pediu
  // para não receber é pior que atrasar um aviso.
  const optOut = await consultarOptOut(perfil.phone)
  if (optOut === 'opt_out') {
    await pular(db, linha, 'opt_out')
    return 'pulada'
  }
  if (optOut === 'desconhecido') {
    await adiar(db, linha, agora, 'optout_indisponivel')
    return 'adiada'
  }

  const primeiroNome = (perfil.full_name ?? '').trim().split(/\s+/)[0] || 'tudo bem'
  const texto = textoDaEtapa(linha.stage, new Date(ledger.expires_at!))
  const template = TEMPLATE_POR_ETAPA[linha.stage]
  const params = [primeiroNome, texto]

  // SELAGEM — a partir daqui a linha nunca mais é reservada pelo worker.
  const { data: selada, error: selErr } = await db
    .from('trial_deliveries')
    .update({ state: 'sealed', sealed_at: agora.toISOString(), template, params, attempts: linha.attempts + 1 })
    .eq('id', linha.id)
    .eq('state', 'reserved')
    .eq('lease_token', token)
    .select('id')

  if (selErr) {
    // Não sabemos se a selagem pegou. NÃO chamamos a Meta: se pegou e enviássemos agora, uma
    // segunda passagem poderia enviar de novo. Deixa para a próxima rodada reler o estado.
    logWarn('[trial/regua] selagem com resultado incerto — envio adiado', { entregaId: linha.id })
    return 'adiada'
  }
  if (!Array.isArray(selada) || selada.length === 0) {
    return 'adiada' // perdeu o lease para outro processo
  }

  const envio = await sendConfirmationTemplate({
    toPhone: perfil.phone,
    template,
    bodyParams: params,
    context: `trial:${linha.stage}`,
    bizOpaqueCallbackData: linha.id,  // volta nos webhooks de status e liga o WAMID a esta linha
    pularOptOut: true,                // já checamos acima, com política mais rígida
  })

  if (envio.desfecho === 'entregue' && envio.wamid) {
    await db.from('trial_deliveries').update({
      state: 'accepted', accepted_at: new Date().toISOString(), provider_id: envio.wamid,
      lease_token: null, lease_until: null,
    }).eq('id', linha.id)
    log('[trial/regua] etapa enviada', { entregaId: linha.id, stage: linha.stage, wamid: envio.wamid })
    return 'enviada'
  }

  if (envio.desfecho === 'recusado') {
    const tentativas = linha.attempts + 1
    const acabaram = tentativas >= MAX_TENTATIVAS
    const proxima = new Date(agora.getTime() + (BACKOFF_MIN[tentativas] ?? 60) * 60_000)
    const passouDoPrazo = proxima.getTime() >= new Date(linha.valid_until).getTime()

    if (acabaram || passouDoPrazo) {
      await db.from('trial_deliveries').update({
        state: 'dead', dead_at: new Date().toISOString(), lease_token: null, lease_until: null,
        last_graph_code: envio.graphCode ? String(envio.graphCode) : null,
        last_http_status: envio.httpStatus ?? null, last_error: envio.skipped ?? null,
      }).eq('id', linha.id)
      logError('[trial/regua] etapa MORTA (tentativas esgotadas ou fora do prazo)', null, {
        entregaId: linha.id, stage: linha.stage, tentativas,
      })
      return 'morta'
    }

    // A Meta respondeu recusando ⇒ nada saiu ⇒ é seguro voltar para a fila.
    await db.from('trial_deliveries').update({
      state: 'pending', next_attempt_at: proxima.toISOString(), lease_token: null, lease_until: null,
      last_graph_code: envio.graphCode ? String(envio.graphCode) : null,
      last_http_status: envio.httpStatus ?? null, last_error: envio.skipped ?? null,
    }).eq('id', linha.id)
    return 'adiada'
  }

  // 'desconhecido' (timeout/rede) ou 'nao_tentado' depois de selar: não sabemos se saiu.
  await db.from('trial_deliveries').update({
    state: 'ambiguous', ambiguous_at: new Date().toISOString(),
    lease_token: null, lease_until: null, last_error: envio.skipped ?? 'sem_resposta',
  }).eq('id', linha.id)
  logError('[trial/regua] AMBÍGUO — pode ter sido enviada; nunca reenviar automaticamente', null, {
    entregaId: linha.id, stage: linha.stage,
  })
  return 'ambigua'
}

async function pular(db: SupabaseClient, linha: LinhaEntrega, motivo: string) {
  await db.from('trial_deliveries').update({
    state: 'skipped', skip_reason: motivo, lease_token: null, lease_until: null,
  }).eq('id', linha.id)
}

async function adiar(db: SupabaseClient, linha: LinhaEntrega, agora: Date, motivo: string) {
  const proxima = new Date(agora.getTime() + 10 * 60_000)
  await db.from('trial_deliveries').update({
    state: 'pending', next_attempt_at: proxima.toISOString(),
    lease_token: null, lease_until: null, last_error: motivo,
  }).eq('id', linha.id)
}

/** Quantas mensagens a régua ainda pode mandar nas próximas 24h. */
async function vagasRestantes(db: SupabaseClient, agora: Date): Promise<number> {
  const desde = new Date(agora.getTime() - 24 * 3600_000).toISOString()
  const { count } = await db
    .from('trial_deliveries')
    .select('id', { count: 'exact', head: true })
    .in('state', ['accepted', 'ambiguous'])   // ambíguo pode ter saído: conta contra o teto
    // Conta pela SELAGEM, não pelo aceite: linha ambígua não tem accepted_at, e é justamente
    // ela que precisa entrar no teto (a mensagem pode ter saído).
    .gte('sealed_at', desde)
  return Math.max(0, TETO_REGUA_24H - (count ?? 0))
}

/** Linha `reserved` com lease vencido volta para a fila. Seguro: nada é enviado antes de selar. */
export async function recolherLeasesVencidos(db: SupabaseClient, agora: Date = new Date()): Promise<number> {
  const { data } = await db
    .from('trial_deliveries')
    .update({ state: 'pending', lease_token: null, lease_until: null })
    .eq('state', 'reserved')
    .lt('lease_until', agora.toISOString())
    .select('id')
  return Array.isArray(data) ? data.length : 0
}
