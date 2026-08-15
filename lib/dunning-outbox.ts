import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export type DunningChannel = 'email' | 'whatsapp'
export type DunningDeliveryStatus = 'accepted' | 'sent' | 'failed'

export type DunningReservation = {
  key: string
  leaseToken: string
  channel: DunningChannel
}

type ReserveParams = {
  profileId: string
  stage: number
  day: string
  channel: DunningChannel
  /** false fora da hora original: somente retoma failed/stale; nunca cria entrega nova. */
  createIfMissing?: boolean
}

const LEASE_MS = 10 * 60_000

export function buildDunningDeliveryKey(params: {
  profileId: string
  stage: number
  day: string
  channel: DunningChannel
}): string {
  return `dunning:${params.profileId}:${params.stage}:${params.day}:${params.channel}`
}

type OutboxQuery = {
  eq: (column: string, value: string) => OutboxQuery
  lt: (column: string, value: string) => OutboxQuery
  select: (columns: string) => Promise<{ data: unknown[] | null; error: { message?: string } | null }>
}

type OutboxTable = {
  insert: (value: unknown) => Promise<{ error: { code?: string; message?: string } | null }>
  update: (value: unknown) => OutboxQuery
}

function table(db: SupabaseClient): OutboxTable {
  return (db as unknown as { from: (name: string) => OutboxTable }).from('dunning_outbox')
}

/**
 * Reserva atômica por canal. Conflito 23505 significa que outra execução já criou a entrega;
 * só retomamos uma falha explícita ou uma reserva abandonada além do lease.
 */
export async function reserveDunningDelivery(
  db: SupabaseClient,
  params: ReserveParams,
): Promise<DunningReservation | null> {
  const key = buildDunningDeliveryKey(params)
  const leaseToken = randomUUID()
  const leasedAt = new Date().toISOString()
  const payload = {
    idempotency_key: key,
    profile_id: params.profileId,
    stage: params.stage,
    day: params.day,
    channel: params.channel,
    status: 'reserved',
    lease_token: leaseToken,
    leased_at: leasedAt,
    last_error: null,
    updated_at: leasedAt,
  }

  if (params.createIfMissing !== false) {
    const { error } = await table(db).insert(payload)
    if (!error) return { key, leaseToken, channel: params.channel }
    if (error.code !== '23505') {
      throw new Error(`falha ao reservar outbox (${error.code ?? 'sem código'}): ${error.message ?? 'erro DB'}`)
    }
  }

  // Falha explícita pode ser retomada imediatamente. O status é o CAS: duas execuções
  // concorrentes não conseguem trocar `failed` por `reserved` ao mesmo tempo.
  const failed = await table(db)
    .update({ status: 'reserved', lease_token: leaseToken, leased_at: leasedAt, last_error: null, updated_at: leasedAt })
    .eq('idempotency_key', key)
    .eq('status', 'failed')
    .select('idempotency_key')
  if (failed.error) throw new Error(`falha ao retomar entrega failed: ${failed.error.message ?? 'erro DB'}`)
  if (failed.data?.length) return { key, leaseToken, channel: params.channel }

  // Reserva órfã: take-over somente após 10 minutos e também via CAS de status+tempo.
  const cutoff = new Date(Date.now() - LEASE_MS).toISOString()
  const stale = await table(db)
    .update({ lease_token: leaseToken, leased_at: leasedAt, last_error: null, updated_at: leasedAt })
    .eq('idempotency_key', key)
    .eq('status', 'reserved')
    .lt('leased_at', cutoff)
    .select('idempotency_key')
  if (stale.error) throw new Error(`falha ao retomar reserva órfã: ${stale.error.message ?? 'erro DB'}`)
  return stale.data?.length ? { key, leaseToken, channel: params.channel } : null
}

/** Chaves que merecem uma tentativa fora da hora original (failed ou reserva possivelmente órfã). */
export async function listRecoverableDunningKeys(db: SupabaseClient, day: string): Promise<Set<string>> {
  type RecoveryQuery = {
    eq: (column: string, value: string) => RecoveryQuery
    in: (column: string, values: string[]) => RecoveryQuery
    limit: (count: number) => Promise<{ data: Array<{ idempotency_key: string }> | null; error: { message?: string } | null }>
  }
  const query = (db as unknown as {
    from: (name: string) => { select: (columns: string) => RecoveryQuery }
  }).from('dunning_outbox').select('idempotency_key')
  const { data, error } = await query
    .eq('day', day)
    .in('status', ['failed', 'reserved'])
    .limit(1000)
  if (error) throw new Error(`falha ao listar outbox recuperável: ${error.message ?? 'erro DB'}`)
  return new Set((data ?? []).map((row) => row.idempotency_key))
}

/**
 * SELA a reserva ANTES de chamar um transporte NÃO-IDEMPOTENTE (a Cloud API do WhatsApp é um).
 *
 * O buraco que isto fecha (achado 15/08, confirmado em dois passes): a ordem era reservar →
 * chamar a Meta → gravar 'sent'. Se a Meta ACEITAVA e a gravação falhava, a linha ficava
 * 'reserved' — e 'reserved' é retomável por DOIS caminhos (a lista de recuperáveis e a própria
 * janela de tolerância de 90 min). Dez minutos depois, a MESMA cobrança saía de novo no celular
 * do cliente. Reenviar cobrança não solicitada é o pior defeito que esta régua pode ter.
 *
 * `accepted` é o estado "entreguei ao transporte e o desfecho é meu problema, não da fila":
 * `listRecoverableDunningKeys` só enxerga 'failed' e 'reserved', e a retomada de reserva órfã
 * também. Selar antes da chamada troca a garantia de AO MENOS UMA para NO MÁXIMO UMA — que é a
 * correta aqui. Perder um lembrete custa um lembrete; duplicar custa a relação.
 *
 * ⚠️ Assimetria DELIBERADA entre canais: o e-mail continua em ao-menos-uma porque a Resend aceita
 * Idempotency-Key determinística — lá o reenvio é absorvido pelo provedor. O WhatsApp não tem
 * equivalente, então é aqui que a trava mora.
 */
export async function sealDunningDelivery(db: SupabaseClient, reservation: DunningReservation): Promise<void> {
  const { data, error } = await table(db)
    .update({ status: 'accepted', updated_at: new Date().toISOString() })
    .eq('idempotency_key', reservation.key)
    .eq('lease_token', reservation.leaseToken)
    .select('idempotency_key')
  if (error) throw new Error(`falha ao selar outbox: ${error.message ?? 'erro DB'}`)
  if (!data?.length) throw new Error('lease da outbox não pertence mais a esta execução')
}

/**
 * DEVOLVE a reserva para a fila — só quando o transporte RECUSOU explicitamente (a Meta respondeu
 * dizendo não) ou nem foi chamado. Nesses casos nada saiu e reenviar é seguro. NUNCA chamar com
 * desfecho desconhecido (timeout/rede): aí a mensagem pode ter saído.
 */
export async function releaseDunningDelivery(
  db: SupabaseClient,
  reservation: DunningReservation,
  erro: string,
): Promise<void> {
  await table(db)
    .update({ status: 'failed', last_error: erro.slice(0, 500), updated_at: new Date().toISOString() })
    .eq('idempotency_key', reservation.key)
    .eq('lease_token', reservation.leaseToken)
}

/** Finaliza somente a reserva que ainda possui o lease; um worker antigo não pisa no novo. */
export async function finishDunningDelivery(
  db: SupabaseClient,
  reservation: DunningReservation,
  status: DunningDeliveryStatus,
  details: { providerMessageId?: string | null; error?: string | null } = {},
): Promise<void> {
  const { data, error } = await table(db)
    .update({
      status,
      provider_message_id: details.providerMessageId ?? null,
      last_error: details.error?.slice(0, 500) ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('idempotency_key', reservation.key)
    .eq('lease_token', reservation.leaseToken)
    .select('idempotency_key')
  if (error) throw new Error(`falha ao finalizar outbox: ${error.message ?? 'erro DB'}`)
  if (!data?.length) throw new Error('lease da outbox não pertence mais a esta execução')
}
