/**
 * lib/hero-demo/followup-worker.ts — o carteiro do follow-up do hero (D-10).
 *
 * Consome `hero_followup_outbox`: para cada teste da demonstração que já passou dos 30 minutos,
 * confere se a pessoa sumiu de verdade e — só nesse caso — manda o template de confirmação.
 *
 * As garantias, e onde cada uma mora:
 *  · NUNCA duas mensagens pelo mesmo teste → UNIQUE (response_id) no banco + claim por CAS.
 *  · NUNCA mensagem por cima de conversa → consulta o estado do contato NA HORA do envio, não
 *    na hora de enfileirar. Estado desconhecido = adia (fail-closed).
 *  · NUNCA reenvio de resultado ambíguo → a Cloud API não tem idempotência; `desfecho` distingue
 *    "não saiu" (seguro repetir) de "não sei se saiu" (nunca repetir).
 *  · NUNCA fora da janela → reconferida no envio: uma fila travada não pode "vazar" às 3h.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { sendConfirmationTemplate } from '@/lib/whatsapp-confirmations'
import { preflightWhatsAppDunning } from '@/lib/whatsapp-preflight'
import { decidirFollowup, type EstadoContato } from './followup'
import { log, logError, logWarn } from '@/lib/logger'

export const TEMPLATE_HERO = 'eidosform_teste_recebido_v1'
const LEASE_MIN = 5

type Linha = {
  id: string
  response_id: string
  phone: string
  nome: string
  objetivo: string
  recomendacao: string
  status: string
  attempts: number
  expires_at: string
}

/**
 * O contato já falou com a gente? LÊ A FICHA (20/08/2026, arquitetura do Sidney).
 *
 * A ficha (`contact_channel_state`) é abastecida pela Elen a cada mensagem recebida e a cada
 * opt-out — então a resposta está no NOSSO banco, em tempo real, sem a Vercel precisar alcançar
 * a VPS. ("Abriu o wa.me" continua inobservável; só a MENSAGEM prova, e é a mensagem que grava.)
 *
 * `desconhecido: true` só quando a LEITURA falha (banco fora, tabela ausente) — e quem chama
 * trata isso como "adiar", nunca como "pode mandar". Ficha SEM linha = nunca falou = pode.
 */
export async function consultarEstadoContato(db: SupabaseClient, phoneDigits: string): Promise<EstadoContato> {
  try {
    const { data, error } = await db
      .from('contact_channel_state')
      .select('last_inbound_at, opted_out')
      .eq('phone', phoneDigits)
      .maybeSingle()
    if (error) {
      logWarn('[hero-followup] ficha ilegível — estado desconhecido (adia)', { erro: error.message })
      return { lastInboundAt: null, optedOut: false, desconhecido: true }
    }
    const f = data as { last_inbound_at: string | null; opted_out: boolean } | null
    if (!f) return { lastInboundAt: null, optedOut: false }
    return {
      lastInboundAt: f.last_inbound_at ? Date.parse(f.last_inbound_at) : null,
      optedOut: f.opted_out === true,
    }
  } catch {
    return { lastInboundAt: null, optedOut: false, desconhecido: true }
  }
}

/** A pessoa virou cliente? O follow-up é para quem sumiu (decisão do Sidney). */
async function criouConta(db: SupabaseClient, email: string | null): Promise<boolean> {
  if (!email) return false
  const { data } = await db.from('profiles').select('id').eq('email', email.toLowerCase().trim()).maybeSingle()
  return Boolean(data)
}

async function reservar(db: SupabaseClient, linha: Linha): Promise<string | null> {
  const lease = randomUUID()
  const { data } = await db
    .from('hero_followup_outbox')
    .update({ status: 'processing', lease_token: lease, leased_at: new Date().toISOString(), updated_at: new Date().toISOString() } as never)
    .eq('id', linha.id)
    .in('status', ['pending', 'failed'])
    .select('id')
  return (data ?? []).length > 0 ? lease : null
}

async function selar(db: SupabaseClient, id: string, lease: string, patch: Record<string, unknown>) {
  const { error } = await db
    .from('hero_followup_outbox')
    .update({ ...patch, lease_token: null, leased_at: null, updated_at: new Date().toISOString() } as never)
    .eq('id', id).eq('lease_token', lease)
  if (error) logError('[hero-followup] falha ao selar', error, { id })
}

/**
 * Processa a fila. `limite` baixo de propósito: isto roda em request serverless; o cron pega o resto.
 */
export async function processarFollowups(db: SupabaseClient, limite = 20): Promise<Record<string, number>> {
  // Porteiro do canal, uma vez por rodada: template APROVADO + UTILITY + qualidade verde, ao vivo.
  // A Meta recategoriza DEPOIS de aprovar — sem esta checagem, uma virada para MARKETING seguiria
  // disparando em silêncio, e quem paga a conta é o número da Elen em produção.
  const porteiro = await preflightWhatsAppDunning([TEMPLATE_HERO])
  if (!porteiro.pode) {
    logWarn('[hero-followup] canal bloqueado nesta rodada', { motivo: porteiro.motivo })
    return { bloqueado: 1 }
  }

  const { data, error } = await db
    .from('hero_followup_outbox')
    .select('id, response_id, phone, nome, objetivo, recomendacao, status, attempts, expires_at')
    .in('status', ['pending', 'failed'])
    .lte('due_at', new Date().toISOString())
    .order('due_at', { ascending: true })
    .limit(limite)
  if (error) { logError('[hero-followup] falha ao ler a fila', error); return {} }

  const contagem: Record<string, number> = {}
  const marcar = (k: string) => { contagem[k] = (contagem[k] ?? 0) + 1 }

  for (const bruto of (data ?? []) as Linha[]) {
    const lease = await reservar(db, bruto)
    if (!lease) { marcar('pulada'); continue }

    // O e-mail vem da resposta, não da fila: é o que liga o teste a uma conta criada depois.
    const { data: resp } = await db
      .from('responses').select('answers').eq('id', bruto.response_id).maybeSingle()
    const answers = (resp as { answers?: Record<string, unknown> } | null)?.answers ?? {}
    const email = Object.values(answers).find(
      (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v),
    ) as string | undefined

    const [contato, temConta] = await Promise.all([
      consultarEstadoContato(db, bruto.phone),
      criouConta(db, email ?? null),
    ])

    const decisao = decidirFollowup({
      telefone: bruto.phone,
      criouConta: temConta,
      contato,
      expiraEm: Date.parse(bruto.expires_at),
    })

    if (!decisao.enviar) {
      if (decisao.definitivo) {
        await selar(db, bruto.id, lease, {
          status: decisao.motivo === 'expirado' ? 'expired' : 'skipped',
          skip_reason: decisao.motivo,
          attempts: bruto.attempts + 1,
          last_attempt_at: new Date().toISOString(),
        })
      } else {
        // Adiável: volta para a fila com nova tentativa mais tarde.
        await selar(db, bruto.id, lease, {
          status: 'pending',
          skip_reason: decisao.motivo,
          attempts: bruto.attempts + 1,
          last_attempt_at: new Date().toISOString(),
          due_at: new Date(Date.now() + 20 * 60_000).toISOString(),
        })
      }
      marcar(decisao.motivo)
      continue
    }

    // ⚠️ SELA ANTES DE CHAMAR A META. A Cloud API não tem idempotência: se o processo morrer
    // depois do envio e antes de gravar, a próxima rodada mandaria OUTRA mensagem no celular
    // de alguém. Garantia "no máximo uma vez" — a mesma disciplina do `dunning_outbox`.
    await selar(db, bruto.id, lease, {
      status: 'sent', sent_at: new Date().toISOString(),
      attempts: bruto.attempts + 1, last_attempt_at: new Date().toISOString(),
    })

    const r = await sendConfirmationTemplate({
      toPhone: bruto.phone,
      template: TEMPLATE_HERO,
      // {{1}} nome · {{2}} objetivo · {{3}} recomendação de plano (nunca Free — regra do Sidney)
      bodyParams: [bruto.nome, bruto.objetivo, bruto.recomendacao],
      context: 'hero-followup',
      eventoDetalhe: 'teste da demonstração',
    })

    if (r.sent) {
      await db.from('hero_followup_outbox')
        .update({ wamid: r.wamid ?? null, updated_at: new Date().toISOString() } as never)
        .eq('id', bruto.id)
      marcar('enviado')
    } else if (r.desfecho === 'nao_tentado' || r.desfecho === 'recusado') {
      // Nada saiu: seguro voltar para a fila.
      await db.from('hero_followup_outbox')
        .update({ status: 'failed', last_error: r.skipped ?? 'recusado',
          due_at: new Date(Date.now() + 30 * 60_000).toISOString(),
          updated_at: new Date().toISOString() } as never)
        .eq('id', bruto.id)
      marcar(`falha_${r.skipped ?? 'recusado'}`)
    } else {
      // DESCONHECIDO: pode ter saído. Fica como 'sent' — reenviar é o erro caro.
      logWarn('[hero-followup] desfecho desconhecido — mantido como enviado, sem reenvio', { id: bruto.id })
      marcar('desconhecido')
    }
  }

  if (Object.keys(contagem).length) log('[hero-followup] rodada', contagem)
  return contagem
}

/** Lease órfão de processo que morreu no meio volta à fila. */
export async function recuperarLeasesHero(db: SupabaseClient): Promise<number> {
  const corte = new Date(Date.now() - LEASE_MIN * 60_000).toISOString()
  const { data, error } = await db
    .from('hero_followup_outbox')
    .update({ status: 'pending', lease_token: null, leased_at: null, updated_at: new Date().toISOString() } as never)
    .eq('status', 'processing').lt('leased_at', corte).select('id')
  if (error) { logError('[hero-followup] falha ao recuperar leases', error); return 0 }
  return (data ?? []).length
}
