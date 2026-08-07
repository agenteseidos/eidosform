/**
 * Registro de ENTREGA de e-mail (auditoria 2026-08, lote 3 · L3-4).
 *
 * O problema que isto resolve: a Resend responde `200 { id }` para dizer "aceitei e vou tentar
 * entregar". A recusa do servidor do destinatário — endereço inexistente, caixa cheia, bloqueio
 * por reputação — chega DEPOIS, num evento assíncrono que ninguém escutava. Resultado prático:
 * um dono de formulário que digitou o e-mail errado no cadastro parava de receber notificação de
 * lead e o sistema continuava logando "email sent". Silêncio dos dois lados.
 *
 * DECISÃO DE DESENHO — a linha é gravada DEPOIS do aceite, nunca antes (`accepted`, jamais
 * `pending`). Uma fila de saída com estado `pending` exigiria um processo que a drena, e um
 * `pending` órfão (processo morto entre gravar e enviar) seria indistinguível de um envio que
 * nunca aconteceu. Aqui a linha só existe se a Resend confirmou o aceite: ela é um COMPROVANTE,
 * não uma intenção. Isso deixa de fora o caso "morreu antes de enviar" — que já é coberto pelo
 * log de erro do chamador — e em troca elimina qualquer chance de estado fantasma.
 *
 * PII: o destinatário é gravado MASCARADO (`maskRecipient`: hash curto + domínio). Dá para
 * correlacionar um bounce a um endereço conhecido re-hasheando o candidato, sem duplicar a base
 * de e-mails em claro numa segunda tabela.
 *
 * TOLERANTE A AUSÊNCIA: enquanto a tabela `email_deliveries` não existir no banco, tudo aqui vira
 * no-op silencioso. Notificação de lead NUNCA pode falhar por causa de telemetria.
 */
import { createClient } from '@supabase/supabase-js'
import { logError, logWarn } from '@/lib/logger'

// Cliente SEM tipagem de `Database`, igual ao `webhook-dispatcher.ts` faz com `webhook_failures`:
// `email_deliveries` não está em `database.types.ts` e — vide Regra Nº 1 do CLAUDE.md — o repo
// não é fonte da verdade sobre o banco. O cliente tipado recusaria a tabela em tempo de compilação.
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/** Status derivados dos eventos da Resend. `accepted` é o estado inicial. */
export type EmailDeliveryStatus =
  | 'accepted'
  | 'delivered'
  | 'delivery_delayed'
  | 'bounced'
  | 'complained'

/** Eventos da Resend que interessam, mapeados para o status persistido. */
const EVENTO_PARA_STATUS: Record<string, EmailDeliveryStatus> = {
  'email.sent': 'accepted',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delivery_delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
}

/**
 * Ordem de avanço. O webhook não garante ordem de chegada: `delivered` pode chegar depois de um
 * `bounced` de outra tentativa, e um `email.sent` atrasado chegaria depois de tudo. Sem esta
 * escada, um evento fora de ordem REBAIXARIA um bounce já registrado para "entregue" — que é
 * exatamente o silêncio que este módulo existe para acabar.
 */
const PESO: Record<EmailDeliveryStatus, number> = {
  accepted: 0,
  delivery_delayed: 1,
  delivered: 2,
  bounced: 3,
  complained: 4,
}

/** Erros de "tabela/coluna não existe" — o banco ainda não recebeu a migration. */
function tabelaAusente(err: { code?: string | null; message?: string | null } | null): boolean {
  if (!err) return false
  // 42P01 = undefined_table (Postgres) · PGRST205 = tabela fora do cache de schema do PostgREST
  return err.code === '42P01' || err.code === 'PGRST205' || /email_deliveries/i.test(err.message || '')
}

/**
 * Grava o comprovante de aceite. Nunca lança e nunca atrasa o chamador de forma perceptível.
 *
 * @param resendId  id devolvido pela Resend — é a chave que liga este envio aos eventos futuros.
 */
export async function recordEmailAccepted(params: {
  resendId: string
  kind: string
  recipientMasked: string
  formId?: string | null
  responseId?: string | null
  role?: string | null
}): Promise<void> {
  if (!params.resendId) return
  try {
    const { error } = await getSupabase()
      .from('email_deliveries')
      .upsert(
        {
          resend_id: params.resendId,
          kind: params.kind,
          recipient_masked: params.recipientMasked,
          form_id: params.formId ?? null,
          response_id: params.responseId ?? null,
          role: params.role ?? null,
          status: 'accepted' satisfies EmailDeliveryStatus,
          accepted_at: new Date().toISOString(),
        },
        // O webhook pode chegar ANTES desta gravação (a Resend é rápida e o envio roda em
        // `after()`). Se já existe linha, ela é mais nova — não sobrescrever com `accepted`.
        { onConflict: 'resend_id', ignoreDuplicates: true }
      )
    if (error && !tabelaAusente(error)) {
      logWarn('[email-delivery] falha ao gravar aceite', { resendId: params.resendId, code: error.code })
    }
  } catch (err) {
    logError('[email-delivery] erro inesperado ao gravar aceite', err, { resendId: params.resendId })
  }
}

/**
 * Aplica um evento da Resend sobre a linha correspondente.
 *
 * @returns `true` se algo foi persistido; `false` se o evento foi ignorado (desconhecido,
 *          retrocesso de status, ou tabela ainda inexistente).
 */
export async function applyResendEvent(params: {
  type: string
  resendId: string
  reason?: string | null
}): Promise<boolean> {
  const status = EVENTO_PARA_STATUS[params.type]
  if (!status || !params.resendId) return false

  try {
    const supabase = getSupabase()
    const { data: atual, error: readErr } = await supabase
      .from('email_deliveries')
      .select('status')
      .eq('resend_id', params.resendId)
      .maybeSingle()

    if (readErr && tabelaAusente(readErr)) return false

    // Evento de um envio que não registramos (e-mail do Supabase Auth, teste manual no painel).
    // Não inventar linha: sem `kind`/`form_id` ela não serve para nada e polui a base.
    if (!atual) return false

    const anterior = (atual.status as EmailDeliveryStatus) ?? 'accepted'
    if ((PESO[status] ?? 0) <= (PESO[anterior] ?? 0)) return false

    const { error: updErr } = await supabase
      .from('email_deliveries')
      .update({
        status,
        reason: params.reason ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('resend_id', params.resendId)

    if (updErr) {
      if (tabelaAusente(updErr)) return false
      logWarn('[email-delivery] falha ao aplicar evento', { resendId: params.resendId, code: updErr.code })
      return false
    }

    // Bounce e reclamação de spam são o motivo de este módulo existir: têm que aparecer no log
    // de erro, não só numa tabela que ninguém consulta.
    if (status === 'bounced' || status === 'complained') {
      logError(`[email-delivery] e-mail NÃO entregue (${status})`, undefined, {
        resendId: params.resendId,
        reason: params.reason ?? null,
      })
    }
    return true
  } catch (err) {
    logError('[email-delivery] erro inesperado ao aplicar evento', err, { resendId: params.resendId })
    return false
  }
}

export const _internals = { EVENTO_PARA_STATUS, PESO, tabelaAusente }
