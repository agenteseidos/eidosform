/**
 * lib/capi-worker.ts — o carteiro da fila do CAPI.
 *
 * Pega linhas `pending`/`retryable` do `capi_outbox`, envia ao Meta e grava o desfecho. Roda em
 * dois lugares com o MESMO código: tentativa imediata pós-submit (best-effort, para o evento
 * chegar em segundos) e o cron de recuperação (o que a tentativa imediata perdeu, ele pega).
 *
 * As garantias, e onde cada uma mora:
 *  · NUNCA duplicar por retentativa → o `event_id` está NA LINHA, gravado na criação; toda
 *    tentativa usa o mesmo, e o Meta descarta o repetido dentro da janela de dedup.
 *  · NUNCA processar a mesma linha duas vezes ao mesmo tempo → claim por CAS: UPDATE condicional
 *    em `status`, com lease. Linha presa (processo morreu) volta quando o lease vence.
 *  · Token revogado NÃO martela o Meta de hora em hora → `blocked_auth`, religado pela rota do
 *    token quando uma credencial nova é salva para o MESMO pixel.
 *  · Evento antigo NUNCA vai para pixel novo → o envio confere `credencial.pixel_id === linha.pixel_id`.
 *  · Resultado AMBÍGUO (timeout) não é retentado para sempre → o Meta deduplica por 48h; depois
 *    disso uma retentativa ambígua poderia contar de novo. `AMBIGUO_MAX_H` corta antes.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { enviarLinhaCapi } from '@/lib/meta-capi'
import { decifrarToken } from '@/lib/capi-credential'
import { log, logError, logWarn } from '@/lib/logger'

const LEASE_MIN = 5
/** Backoff: 1min, 4min, 16min, ~1h, 4h, teto 6h. Jitter de até 20% contra rebanho. */
function proximaTentativaMs(attempts: number): number {
  const base = Math.min(60_000 * Math.pow(4, attempts), 6 * 3600_000)
  return base + Math.floor(Math.random() * base * 0.2)
}
/** Depois de 48h do event_time, retentativa de resultado ambíguo pode virar evento NOVO no Meta. */
const AMBIGUO_MAX_H = 48

type Linha = {
  id: string
  response_id: string
  form_id: string
  trigger_id: string
  pixel_id: string
  event_name: string
  event_id: string
  event_time: string
  value: number | null
  currency: string | null
  action_source: string
  event_source_url: string | null
  user_data: Record<string, unknown>
  test_event_code: string | null
  status: string
  attempts: number
  expires_at: string
}

/** Tenta reservar UMA linha. CAS: só ganha quem trocar o status primeiro. */
async function reservar(db: SupabaseClient, linha: Linha): Promise<string | null> {
  const lease = randomUUID()
  const { data } = await db
    .from('capi_outbox')
    .update({
      status: 'processing', lease_token: lease, leased_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', linha.id)
    .in('status', ['pending', 'retryable'])
    .select('id')
  return (data ?? []).length > 0 ? lease : null
}

async function gravarDesfecho(
  db: SupabaseClient, linha: Linha, lease: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await db
    .from('capi_outbox')
    .update({ ...patch, lease_token: null, leased_at: null, updated_at: new Date().toISOString() } as never)
    .eq('id', linha.id)
    .eq('lease_token', lease)
  if (error) logError('[capi-worker] falha ao gravar desfecho', error, { linha: linha.id })
}

/**
 * Processa UMA linha já lida do banco. Devolve o status final (para telemetria de quem chama).
 */
export async function processarLinha(db: SupabaseClient, linha: Linha): Promise<string> {
  const agora = Date.now()

  // Expirada? O Meta recusa evento com mais de 7 dias — não gasta tentativa.
  if (Date.parse(linha.expires_at) <= agora) {
    await db.from('capi_outbox')
      .update({ status: 'expired', updated_at: new Date().toISOString() } as never)
      .eq('id', linha.id).in('status', ['pending', 'retryable'])
    return 'expired'
  }

  // Resultado ambíguo fora da janela de dedup: parar. (Só afeta linhas que JÁ tentaram.)
  if (linha.attempts > 0 && agora - Date.parse(linha.event_time) > AMBIGUO_MAX_H * 3600_000) {
    await db.from('capi_outbox')
      .update({ status: 'expired', last_error: 'janela de deduplicação (48h) esgotada', updated_at: new Date().toISOString() } as never)
      .eq('id', linha.id).in('status', ['pending', 'retryable'])
    return 'expired'
  }

  const lease = await reservar(db, linha)
  if (!lease) return 'pulada' // outro processo chegou primeiro

  // Credencial ATUAL do formulário — token não mora na fila.
  const { data: cred } = await db
    .from('form_capi_credentials')
    .select('token_encrypted, pixel_id')
    .eq('form_id', linha.form_id)
    .maybeSingle()
  const c = cred as { token_encrypted?: string; pixel_id?: string | null } | null

  // Pixel trocado depois que o evento nasceu → o evento é do pixel ANTIGO; não existe envio
  // legítimo possível. Morre com o motivo registrado.
  if (!c || (c.pixel_id ?? '') !== linha.pixel_id) {
    await gravarDesfecho(db, linha, lease, {
      status: 'dead',
      last_error: !c ? 'credencial removida' : 'pixel do formulário mudou após o evento',
      attempts: linha.attempts + 1, last_attempt_at: new Date().toISOString(),
    })
    return 'dead'
  }

  const token = decifrarToken(c.token_encrypted, linha.form_id)
  if (!token) {
    await gravarDesfecho(db, linha, lease, {
      status: 'blocked_auth', last_error: 'token não decifrável (chave trocada?)',
      attempts: linha.attempts + 1, last_attempt_at: new Date().toISOString(),
    })
    return 'blocked_auth'
  }

  // Código de teste NUNCA sobrevive à retentativa tardia: um teste de ontem não pode virar
  // conversão marcada como teste hoje — nem o contrário. Só a 1ª tentativa o carrega.
  const testCode = linha.attempts === 0 ? linha.test_event_code : null

  const r = await enviarLinhaCapi({
    pixelId: linha.pixel_id, accessToken: token,
    eventName: linha.event_name, eventId: linha.event_id, eventTime: linha.event_time,
    userData: linha.user_data, value: linha.value, currency: linha.currency,
    actionSource: linha.action_source, eventSourceUrl: linha.event_source_url,
    testEventCode: testCode,
  })

  const tentativas = linha.attempts + 1
  const agoraISO = new Date().toISOString()

  if (r.tipo === 'enviado') {
    await gravarDesfecho(db, linha, lease, { status: 'sent', sent_at: agoraISO, attempts: tentativas, last_attempt_at: agoraISO, last_error: null })
    return 'sent'
  }
  if (r.tipo === 'bloqueado_auth') {
    await gravarDesfecho(db, linha, lease, { status: 'blocked_auth', attempts: tentativas, last_attempt_at: agoraISO, last_error: `auth recusada (código ${r.codigo ?? '?'})` })
    return 'blocked_auth'
  }
  if (r.tipo === 'morto') {
    await gravarDesfecho(db, linha, lease, { status: 'dead', attempts: tentativas, last_attempt_at: agoraISO, last_error: `payload recusado (código ${r.codigo ?? '?'})` })
    return 'dead'
  }
  // retentável
  const atrasoMs = r.retryAfterS ? r.retryAfterS * 1000 : proximaTentativaMs(tentativas)
  await gravarDesfecho(db, linha, lease, {
    status: 'retryable', attempts: tentativas, last_attempt_at: agoraISO,
    next_attempt_at: new Date(Date.now() + atrasoMs).toISOString(),
    last_error: `falha passageira (código ${r.codigo ?? 'rede'})`,
  })
  return 'retryable'
}

/**
 * Processa o que estiver pronto. `responseId` restringe à resposta recém-gravada (tentativa
 * imediata); sem ele, varre a fila (cron). Concorrência baixa e teto de lote de propósito:
 * isto roda dentro de request serverless — o cron pega o resto.
 */
export async function processarFila(
  db: SupabaseClient,
  params: { responseId?: string; limite?: number } = {},
): Promise<Record<string, number>> {
  const limite = params.limite ?? 10
  let q = db
    .from('capi_outbox')
    .select('id, response_id, form_id, trigger_id, pixel_id, event_name, event_id, event_time, value, currency, action_source, event_source_url, user_data, test_event_code, status, attempts, expires_at')
    .in('status', ['pending', 'retryable'])
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(limite)
  if (params.responseId) q = q.eq('response_id', params.responseId)

  const { data, error } = await q
  if (error) {
    logError('[capi-worker] falha ao ler a fila', error)
    return {}
  }

  const contagem: Record<string, number> = {}
  for (const linha of (data ?? []) as Linha[]) {
    const fim = await processarLinha(db, linha)
    contagem[fim] = (contagem[fim] ?? 0) + 1
  }
  if (Object.keys(contagem).length) log('[capi-worker] rodada', contagem)
  return contagem
}

/**
 * Recupera lease órfão: linha `processing` cujo dono morreu. Chamada pelo cron.
 */
export async function recuperarLeasesOrfaos(db: SupabaseClient): Promise<number> {
  const corte = new Date(Date.now() - LEASE_MIN * 60_000).toISOString()
  const { data, error } = await db
    .from('capi_outbox')
    .update({ status: 'retryable', lease_token: null, leased_at: null, updated_at: new Date().toISOString() } as never)
    .eq('status', 'processing')
    .lt('leased_at', corte)
    .select('id')
  if (error) { logError('[capi-worker] falha ao recuperar leases', error); return 0 }
  const n = (data ?? []).length
  if (n) logWarn('[capi-worker] leases órfãos recuperados', { quantidade: n })
  return n
}

/**
 * Religa as linhas `blocked_auth` de um formulário — chamada pela rota do token quando uma
 * credencial NOVA é validada para o MESMO pixel. Token revogado não mata o evento; corrige-se a
 * configuração e a fila anda.
 */
export async function religarBloqueadas(db: SupabaseClient, formId: string, pixelId: string): Promise<number> {
  const { data, error } = await db
    .from('capi_outbox')
    .update({ status: 'retryable', next_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() } as never)
    .eq('form_id', formId)
    .eq('pixel_id', pixelId)
    .eq('status', 'blocked_auth')
    .gt('expires_at', new Date().toISOString())
    .select('id')
  if (error) { logError('[capi-worker] falha ao religar bloqueadas', error); return 0 }
  return (data ?? []).length
}
