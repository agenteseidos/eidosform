/**
 * lib/notification-baseline.ts — corte SEM FILA RETROATIVA das notificações
 * de abandono por e-mail (pedido Sidney, 2026-08-05).
 *
 * ─── O PROBLEMA QUE ISTO MATA ────────────────────────────────────────────────
 *
 * O cron de abandono marca "já avisei" POR DESTINATÁRIO. Consequência: quando
 * um destinatário passa a existir (chave do dono religada, e-mail adicional
 * configurado), toda resposta abandonada ainda dentro do lookback de 72h volta
 * a ser candidata e o endereço novo recebe o ACERVO de uma vez — em 05/08
 * foram 10 "Lead incompleto" no mesmo minuto. Para uso interno era tolerável;
 * para um cliente, a rajada parece defeito.
 *
 * A regra nova: ativar uma chave vale DAQUI PRA FRENTE. No instante em que um
 * destinatário entra na lista efetiva, gravamos um claim-baseline ("tratado,
 * suprimido de propósito") para cada abandono JÁ EXISTENTE do formulário. O
 * cron não muda: os claims fazem o trabalho.
 *
 * Por que claims-baseline e não um timestamp de ativação no formulário: a
 * tabela `form_notification_logs` já existe e já é a fonte da verdade de "quem
 * foi tratado" — um timestamp exigiria migration manual (Sidney no SQL Editor)
 * e uma segunda fonte de verdade no cron.
 *
 * ─── ORDEM IMPORTA ───────────────────────────────────────────────────────────
 *
 * O baseline roda ANTES do UPDATE que liga a chave (fail-closed): se o
 * baseline falhar, a chave NÃO liga e o usuário vê erro e tenta de novo. Se o
 * baseline gravar e o UPDATE falhar, sobram claims inofensivos (o destinatário
 * nem está ativo) e a repetição é idempotente (upsert ignora duplicata).
 */
import { createHash } from 'crypto'
import { resolveEmailRecipients, type EmailRecipient } from './notification-email'

export const ABANDONED_EVENT = 'abandoned'
export const EMAIL_CHANNEL = 'email'

/** Mesmo lookback da varredura do cron: abandono mais velho que isto nunca é examinado. */
const LOOKBACK_HOURS = 72
const PAGE_SIZE = 200
/** 25×200 = 5.000 parciais abandonadas de UM formulário em 72h — se bater aqui, algo está muito errado. */
const MAX_PAGES = 25

/** Marcador de auditoria: claim que NUNCA virou e-mail, por decisão de produto. */
export const BASELINE_MARKER =
  'baseline: chave ativada depois do abandono — aviso retroativo suprimido de propósito (sem fila)'

/** Hash do destinatário — auditoria sem guardar o endereço (canônico; o cron re-exporta daqui). */
export function recipientHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
}

/**
 * Um lead está pronto para virar e-mail? Exige ao menos UMA resposta com
 * conteúdo — alertar sobre um formulário em branco seria ruído para o dono.
 * (Canônico; movido do cron de e-mail, que re-exporta daqui.)
 *
 * No baseline o filtro é o MESMO do cron de propósito: resposta sem conteúdo
 * não ganha claim aqui porque também nunca ganharia envio lá — e se o lead
 * voltar a digitar, o `last_activity_at` avança e o abandono passa a ser
 * posterior à ativação, ou seja, legitimamente notificável.
 */
export function hasAnsweredSomething(answers: unknown): boolean {
  if (!answers || typeof answers !== 'object') return false
  return Object.values(answers as Record<string, unknown>).some((v) => {
    if (v === null || v === undefined) return false
    if (typeof v === 'string') return v.trim().length > 0
    if (Array.isArray(v)) return v.length > 0
    if (typeof v === 'object') return Object.keys(v as object).length > 0
    return true
  })
}

export interface NotifyFields {
  notify_owner_enabled: boolean | null
  notify_email_enabled: boolean | null
  notify_email: string | null
}

/**
 * Quais destinatários PASSAM A EXISTIR com este save?
 *
 * Compara a lista EFETIVA de destinatários (resolvida pelo mesmo
 * `resolveEmailRecipients` do cron) antes × depois do PATCH. Comparar listas
 * efetivas — e não campos crus — cobre os caminhos indiretos: e-mail adicional
 * digitado com a chave já ligada, e o caso de canto em que o endereço extra
 * era igual ao do dono (deduplicado para fora da lista) e passa a divergir.
 *
 * `next` traz só o que o PATCH enviou (undefined = campo não tocado).
 */
export function detectNewlyActivatedRecipients(input: {
  prev: NotifyFields
  next: Partial<NotifyFields>
  ownerEmail: string | null | undefined
}): EmailRecipient[] {
  const { prev, next, ownerEmail } = input
  const effective = <K extends keyof NotifyFields>(key: K): NotifyFields[K] =>
    (next[key] === undefined ? prev[key] : next[key]) as NotifyFields[K]

  const prevRecipients = resolveEmailRecipients({
    ownerEmail,
    notifyEmail: prev.notify_email,
    notifyEmailEnabled: prev.notify_email_enabled,
    notifyOwnerEnabled: prev.notify_owner_enabled,
  })
  const nextRecipients = resolveEmailRecipients({
    ownerEmail,
    notifyEmail: effective('notify_email'),
    notifyEmailEnabled: effective('notify_email_enabled'),
    notifyOwnerEnabled: effective('notify_owner_enabled'),
  })
  return nextRecipients.filter((r) => !prevRecipients.some((p) => p.role === r.role))
}

/** Contrato estrutural mínimo — `form_notification_logs` não está nos tipos gerados (migration manual). */
export interface BaselineClient {
  from(table: 'responses'): {
    select(cols: string): {
      eq(col: string, v: unknown): {
        eq(col: string, v: unknown): {
          gt(col: string, v: string): {
            lt(col: string, v: string): {
              order(col: string, opts: { ascending: boolean }): {
                limit(n: number): PromiseLike<{ data: unknown[] | null; error: unknown }>
              }
            }
          }
        }
      }
    }
  }
  from(table: 'form_notification_logs'): {
    upsert(
      rows: Record<string, unknown>[],
      opts: { onConflict: string; ignoreDuplicates: boolean }
    ): PromiseLike<{ error: unknown }>
  }
}

interface CandidateRow {
  id: string
  answers: unknown
  last_activity_at: string
}

/**
 * Grava o baseline: um claim terminal por (abandono existente × destinatário
 * novo). Status `sent` (o CHECK da tabela só aceita pending/sent/failed;
 * `failed` sujaria auditoria de falha real) com `provider_message_id` nulo e
 * `error_message` = BASELINE_MARKER — o trio identifica supressão na leitura.
 *
 * Lança em qualquer erro — o chamador decide o fail-closed.
 */
export async function baselineAbandonedEmailClaims(opts: {
  client: BaselineClient
  formId: string
  recipients: EmailRecipient[]
  thresholdMin: number
  now?: number
}): Promise<{ responses: number; claimed: number }> {
  const { client, formId, recipients, thresholdMin } = opts
  if (recipients.length === 0) return { responses: 0, claimed: 0 }

  const now = opts.now ?? Date.now()
  const cutoffIso = new Date(now - thresholdMin * 60_000).toISOString()
  const lookbackIso = new Date(now - LOOKBACK_HOURS * 3_600_000).toISOString()

  let cursor = lookbackIso
  let responses = 0
  let claimed = 0

  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) {
      throw new Error(`baseline: mais de ${MAX_PAGES * PAGE_SIZE} parciais abandonadas no formulário ${formId} — abortado (fail-closed)`)
    }
    // `gt` no cursor (não `gte`): garante avanço mesmo com timestamps iguais no
    // corte da página; um empate de microssegundo eventualmente pulado é coberto
    // pelo upsert idempotente numa repetição.
    const { data, error } = await client
      .from('responses')
      .select('id, answers, last_activity_at')
      .eq('form_id', formId)
      .eq('completed', false)
      .gt('last_activity_at', cursor)
      .lt('last_activity_at', cutoffIso)
      .order('last_activity_at', { ascending: true })
      .limit(PAGE_SIZE)
    if (error) throw new Error(`baseline: falha lendo parciais abandonadas — ${JSON.stringify(error).slice(0, 200)}`)

    const rows = (data ?? []) as CandidateRow[]
    if (rows.length === 0) break

    const eligible = rows.filter((r) => hasAnsweredSomething(r.answers))
    if (eligible.length > 0) {
      const claims = eligible.flatMap((r) =>
        recipients.map((recipient) => ({
          response_id: r.id,
          form_id: formId,
          event_type: ABANDONED_EVENT,
          channel: EMAIL_CHANNEL,
          recipient_role: recipient.role,
          recipient_hash: recipientHash(recipient.email),
          status: 'sent',
          attempts: 0,
          provider_message_id: null,
          error_message: BASELINE_MARKER,
        }))
      )
      const { error: upsertErr } = await client
        .from('form_notification_logs')
        .upsert(claims, {
          onConflict: 'response_id,event_type,channel,recipient_role',
          ignoreDuplicates: true,
        })
      if (upsertErr) throw new Error(`baseline: falha gravando claims — ${JSON.stringify(upsertErr).slice(0, 200)}`)
      responses += eligible.length
      claimed += claims.length
    }

    if (rows.length < PAGE_SIZE) break
    cursor = rows[rows.length - 1].last_activity_at
  }

  return { responses, claimed }
}
