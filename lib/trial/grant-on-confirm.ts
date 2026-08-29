/**
 * Concessão do trial no momento em que a pessoa confirma o e-mail.
 *
 * Por que aqui e não no cadastro: confirmar o e-mail é a prova de que a conta é de quem diz ser.
 * Conceder antes disso entregaria 30 dias de Plus para qualquer endereço digitado.
 *
 * ORDEM (importa):
 *   1. RECUPERAÇÃO primeiro. O cadastro cria o usuário no Supabase e só depois grava o vínculo;
 *      se o processo morrer entre os dois, quem confirma o e-mail rápido chegaria aqui sem ledger
 *      nenhum — e receberia a mensagem genérica de "cadastro confirmado", quebrando a promessa
 *      do convite. Então, antes de decidir qualquer coisa, tentamos concluir o vínculo.
 *   2. CONCESSÃO sob o lock de ativação (a RPC exige a posse: é a mesma chave do pagamento).
 *   3. SÓ ENTÃO a decisão sobre a mensagem. Ela olha o estado ANTES do grant (que limpa campos),
 *      por isso é calculada a partir do que descobrimos nos passos 1 e 2.
 *
 * Esta função nunca lança: confirmação de e-mail não pode falhar por causa do trial.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { acquireLock, releaseLock } from '@/lib/billing-lock'
import { log, logError } from '@/lib/logger'

export type ResultadoTrialNaConfirmacao = {
  /** Conta nasceu de uma campanha de trial? Se sim, a mensagem genérica NÃO deve ser enviada. */
  ehTrial: boolean
  /** O plano foi efetivamente concedido agora (ou já estava concedido). */
  concedido: boolean
  /** Quando o acesso termina, se concedido. */
  expiresAt: string | null
  /** Motivo da recusa, quando não concedeu (para log; nunca é mostrado ao cliente). */
  motivo: string | null
}

const NEUTRO: ResultadoTrialNaConfirmacao = { ehTrial: false, concedido: false, expiresAt: null, motivo: null }

export async function concederTrialNaConfirmacao(
  userId: string,
  userMetadata: Record<string, unknown> | null | undefined
): Promise<ResultadoTrialNaConfirmacao> {
  try {
    const admin = createAdminClient()

    // ── 1. Recuperação: existe um cadastro de trial que não chegou a virar ledger?
    const { data: ledgerExistente } = await admin
      .from('plan_trials')
      .select('status')
      .eq('profile_id', userId)
      .maybeSingle()

    let ehTrial = Boolean(ledgerExistente)

    if (!ledgerExistente) {
      // Sem ledger. O intent é a evidência durável criada ANTES da conta: se ele existe e aponta
      // para este usuário, o vínculo apenas não chegou a ser gravado. A RPC revalida tudo
      // (usuário real em auth.users, hash do e-mail, telefone) — aqui só a localizamos.
      const intentId =
        (typeof userMetadata?.trial_intent === 'string' && userMetadata.trial_intent) || null

      let alvo = intentId
      if (!alvo) {
        const { data: porUsuario } = await admin
          .from('trial_signup_intents')
          .select('id')
          .eq('user_id', userId)
          .in('state', ['reserved', 'bound'])
          .maybeSingle()
        alvo = porUsuario?.id ?? null
      }

      if (alvo) {
        const { data: bind, error: bindErr } = await admin.rpc('trial_signup_bind', {
          p_intent_id: alvo,
          p_user_id: userId,
        })
        if (bindErr) {
          logError('[trial] bind de recuperação falhou', bindErr, { userId })
        } else if ((bind as { ok?: boolean } | null)?.ok) {
          ehTrial = true
          log('[trial] vínculo concluído na confirmação (recuperação)', { userId })
        }
      }
    }

    if (!ehTrial) return NEUTRO

    // ── 2. Concessão sob o lock de ativação. Ocupado = pagamento sendo ativado agora: não
    // insistimos aqui; o reconciliador concede depois. Melhor atrasar o trial do que disputar
    // o mesmo perfil com o fluxo que envolve dinheiro.
    const lockKey = `activation:${userId}`
    const token = await acquireLock(admin, lockKey)
    if (!token) {
      log('[trial] lock ocupado na confirmação — concessão adiada para o reconciliador', { userId })
      return { ehTrial: true, concedido: false, expiresAt: null, motivo: 'lock_ocupado' }
    }

    try {
      const { data, error } = await admin.rpc('grant_trial', {
        p_profile_id: userId,
        p_owner_token: token,
      })
      if (error) {
        logError('[trial] grant_trial falhou', error, { userId })
        return { ehTrial: true, concedido: false, expiresAt: null, motivo: 'erro_rpc' }
      }
      const r = (data ?? {}) as { ok?: boolean; motivo?: string; expires_at?: string; ja_concedido?: boolean }
      if (r.ok) {
        log('[trial] plano concedido', { userId, expiresAt: r.expires_at, jaEstava: Boolean(r.ja_concedido) })
        return { ehTrial: true, concedido: true, expiresAt: r.expires_at ?? null, motivo: null }
      }
      // Recusa legítima (prazo vencido, conta já paga, checkout em andamento). A conta segue
      // normal, em Free — e a mensagem genérica continua suprimida, porque a pessoa VEIO de uma
      // campanha de trial e receber "bem-vindo" depois de perder o acesso seria pior.
      log('[trial] concessão recusada', { userId, motivo: r.motivo })
      return { ehTrial: true, concedido: false, expiresAt: null, motivo: r.motivo ?? 'desconhecido' }
    } finally {
      await releaseLock(admin, lockKey, token)
    }
  } catch (err) {
    logError('[trial] erro inesperado na concessão (confirmação segue normalmente)', err, { userId })
    return NEUTRO
  }
}
