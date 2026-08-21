/**
 * lib/hero-demo/enfileirar.ts — o teste da demonstração vira uma linha na fila do follow-up.
 *
 * Chamado no submit do formulário do hero (e SÓ dele). Best-effort de ponta a ponta: falhar aqui
 * nunca pode derrubar a gravação do lead — perder o WhatsApp de cortesia é infinitamente menos
 * grave que perder o lead que a landing pagou para capturar.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { HERO_FORM_ID, HERO_Q, recomendarPlano } from './config'
import { calcularDueAt, normalizarTelefone, VALIDADE_H } from './followup'
import { log, logWarn } from '@/lib/logger'

/** É o formulário do hero? Só ele gera follow-up. */
export function ehFormularioDoHero(formId: string | null | undefined): boolean {
  return formId === HERO_FORM_ID
}

export async function enfileirarFollowupDoHero(
  db: SupabaseClient,
  params: { responseId: string; answers: Record<string, unknown> },
): Promise<void> {
  try {
    const a = params.answers
    const telefone = normalizarTelefone(String(a[HERO_Q.whatsapp] ?? ''))
    if (!telefone) {
      // Sem telefone não há mensagem possível. Não cria linha: fila só guarda o que pode sair.
      log('[hero-followup] sem telefone válido — nada enfileirado', { responseId: params.responseId })
      return
    }
    const nome = String(a[HERO_Q.nome] ?? '').trim().split(/\s+/)[0] || 'tudo bem'
    const objetivo = String(a[HERO_Q.objetivo] ?? '').trim() || 'melhorar seus formulários'
    const volume = String(a[HERO_Q.volume] ?? '')
    const rec = recomendarPlano(volume)

    const agora = Date.now()
    const { error } = await db.from('hero_followup_outbox').insert({
      response_id: params.responseId,
      phone: telefone,
      nome,
      objetivo,
      // A frase que viaja no {{3}} do template. Montada AQUI, no servidor — o navegador não
      // escolhe o que a mensagem diz. ⚠️ Nunca contém o plano Free (regra do Sidney).
      recomendacao: `Com base nas suas respostas, ${rec.frase}.`,
      due_at: new Date(calcularDueAt(agora)).toISOString(),
      expires_at: new Date(agora + VALIDADE_H * 3600_000).toISOString(),
    } as never)

    // 23505 = já existe follow-up para esta resposta (retry do POST). É o caso NORMAL.
    if (error && !String((error as { code?: string }).code).includes('23505')) {
      logWarn('[hero-followup] falha ao enfileirar (não bloqueante)', { responseId: params.responseId })
      return
    }
    log('[hero-followup] enfileirado', { responseId: params.responseId, plano: rec.plano })
  } catch {
    // Silencioso de propósito: o lead já está gravado, que é o que importa.
  }
}
