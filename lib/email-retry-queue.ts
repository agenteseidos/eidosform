/**
 * Fila de reenvio de e-mail — D-05 (auditoria 2026-08, lote 3 · L3-4 segunda metade).
 *
 * O DEFEITO QUE ISTO FECHA: `sendEmailWithRetry` tenta 3 vezes em ~16 segundos e desiste. Resend
 * fora do ar por alguns minutos = todo aviso de lead daquela janela perdido em definitivo. O
 * WhatsApp já tinha fila de reenvio; o e-mail, não.
 *
 * ⚠️ REGRA DE OURO DESTE MÓDULO: **a fila guarda REFERÊNCIA, nunca conteúdo.** Nada de endereço
 * de e-mail, nome do lead ou respostas — só `form_id`, `response_id` e o PAPEL do destinatário.
 * O e-mail é remontado a partir do banco no momento do reenvio. Foi essa decisão (Sidney,
 * 11/08/2026) que destravou a demanda: o lote 3 a adiou justamente porque guardar o payload
 * duplicaria dado pessoal em repouso.
 *
 * Três consequências que caem de graça:
 *  · resposta APAGADA antes do reenvio → o reenvio é pulado; a exclusão é respeitada sem rotina
 *    de expurgo nenhuma;
 *  · e-mail de notificação TROCADO depois da falha → o reenvio vai para o endereço novo, porque
 *    o destinatário é re-resolvido, não lembrado;
 *  · a retenção deixa de ser questão sensível — não há o que reter.
 *
 * TOLERANTE À AUSÊNCIA DA TABELA: se a migration ainda não rodou, tudo vira no-op silencioso.
 * Mesmo contrato de `email-delivery.ts` — o deploy do código nunca depende da ordem do SQL.
 */
import { createClient } from '@supabase/supabase-js'
import { logError, logWarn, log } from '@/lib/logger'

/** Janela total de vida de um item na fila. Decisão do Sidney (11/08/2026): 48 horas. */
export const JANELA_MS = 48 * 60 * 60 * 1000

/**
 * Espera antes de cada tentativa, em minutos. Começa curto (queda de minutos é o caso comum) e
 * abre rápido para não martelar um provedor que está fora há horas.
 *
 * ⚠️ A SOMA TEM DE COBRIR A JANELA, e o teste trava isso. Na 1ª versão eu somei 44,6h contra uma
 * janela de 48h: os itens morriam por ESGOTAR TENTATIVAS antes de a janela vencer, e a janela
 * — que é a decisão do Sidney — virava enfeite. O último degrau foi esticado para fechar a conta
 * com folga; quem manda no fim da vida é `janelaVencida`, não o tamanho desta lista.
 */
export const BACKOFF_MIN = [5, 30, 120, 360, 720, 1440, 1440] as const

export type PapelDestinatario = 'owner' | 'form_email'

export type ItemFila = {
  id: string
  kind: string
  form_id: string
  response_id: string
  role: PapelDestinatario
  attempts: number
  first_failed_at: string
}

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

/** Erro de tabela ausente (migration não rodou) — vira no-op, nunca ruído. */
function tabelaAusente(erro: { code?: string; message?: string } | null): boolean {
  if (!erro) return false
  return erro.code === '42P01' || /email_retry_queue.*does not exist/i.test(erro.message ?? '')
}

/** Quando tentar de novo, dado o número de tentativas já feitas. */
export function proximaTentativaEm(attempts: number, agora = Date.now()): Date {
  const minutos = BACKOFF_MIN[Math.min(attempts, BACKOFF_MIN.length - 1)]
  return new Date(agora + minutos * 60_000)
}

/** A janela de 48h já venceu para este item? */
export function janelaVencida(firstFailedAtIso: string, agora = Date.now()): boolean {
  const inicio = Date.parse(firstFailedAtIso)
  if (Number.isNaN(inicio)) return false // data ilegível não mata o item: erra a favor de tentar
  return agora - inicio >= JANELA_MS
}

/**
 * Registra que um envio falhou. Idempotente por (kind, response_id, role): a mesma falha
 * reentrando não empilha linhas — reenvio duplicado é spam para o dono.
 */
export async function enfileirarReenvio(params: {
  kind: string
  formId: string
  responseId: string
  role: PapelDestinatario
  erro?: string
}): Promise<{ enfileirado: boolean; motivo?: string }> {
  const supabase = db()
  if (!supabase) return { enfileirado: false, motivo: 'sem_service_role' }
  try {
    const { error } = await supabase
      .from('email_retry_queue')
      .upsert({
        kind: params.kind,
        form_id: params.formId,
        response_id: params.responseId,
        role: params.role,
        last_error: (params.erro ?? '').slice(0, 500),
        status: 'pending',
        next_attempt_at: proximaTentativaEm(0).toISOString(),
      }, { onConflict: 'kind,response_id,role', ignoreDuplicates: true })
    if (error) {
      if (tabelaAusente(error)) return { enfileirado: false, motivo: 'tabela_ausente' }
      logWarn('[email-retry] falha ao enfileirar (não bloqueante)', { erro: error.message })
      return { enfileirado: false, motivo: 'erro_db' }
    }
    log('[email-retry] envio falho enfileirado p/ reenvio', {
      kind: params.kind, formId: params.formId, responseId: params.responseId, role: params.role,
    })
    return { enfileirado: true }
  } catch (err) {
    logWarn('[email-retry] exceção ao enfileirar (não bloqueante)', { err: String(err).slice(0, 120) })
    return { enfileirado: false, motivo: 'excecao' }
  }
}

/** Itens prontos para nova tentativa. */
export async function lerPendentes(limite = 50): Promise<ItemFila[]> {
  const supabase = db()
  if (!supabase) return []
  const { data, error } = await supabase
    .from('email_retry_queue')
    .select('id, kind, form_id, response_id, role, attempts, first_failed_at')
    .eq('status', 'pending')
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(limite)
  if (error) {
    if (!tabelaAusente(error)) logError('[email-retry] leitura da fila falhou', error)
    return []
  }
  return (data ?? []) as ItemFila[]
}

export async function marcarEnviado(id: string): Promise<void> {
  const supabase = db()
  if (!supabase) return
  await supabase.from('email_retry_queue')
    .update({ status: 'sent', updated_at: new Date().toISOString() })
    .eq('id', id)
}

/** Nova falha: agenda a próxima tentativa, ou mata o item se a janela venceu. */
export async function marcarTentativaFalha(item: ItemFila, erro: string): Promise<'reagendado' | 'morto'> {
  const supabase = db()
  if (!supabase) return 'reagendado'
  const tentativas = item.attempts + 1
  const morre = janelaVencida(item.first_failed_at) || tentativas > BACKOFF_MIN.length
  await supabase.from('email_retry_queue')
    .update({
      attempts: tentativas,
      last_error: erro.slice(0, 500),
      status: morre ? 'dead' : 'pending',
      next_attempt_at: proximaTentativaEm(tentativas).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', item.id)
  return morre ? 'morto' : 'reagendado'
}

/**
 * Item descartado sem tentar: a resposta ou o formulário não existem mais. NÃO é falha — é a
 * exclusão do dado sendo respeitada. Fecha como 'dead' sem alarme.
 */
export async function descartarSemAlvo(id: string, motivo: string): Promise<void> {
  const supabase = db()
  if (!supabase) return
  await supabase.from('email_retry_queue')
    .update({ status: 'dead', last_error: `descartado: ${motivo}`, updated_at: new Date().toISOString() })
    .eq('id', id)
}
