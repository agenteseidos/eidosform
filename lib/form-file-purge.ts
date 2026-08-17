/**
 * lib/form-file-purge.ts — apagar passa a apagar.
 *
 * O DEFEITO QUE ISTO FECHA (achado do parecer independente, 16/08): excluir uma resposta, um
 * formulário ou a CONTA INTEIRA não removia nada do storage. O arquivo do respondente sobrevivia
 * — e, até este lote, num endereço público permanente.
 *
 * Isso não era só dívida técnica. `app/(public)/privacidade/page.tsx` promete, publicado:
 * *"Após exclusão da conta: dados pessoais são anonimizados ou deletados em até 30 dias"*.
 * O sistema não cumpria. Promessa publicada que o código não honra é problema jurídico, não
 * apenas de engenharia.
 *
 * ORDEM DELIBERADA: revoga PRIMEIRO (o link morre no ato, mesmo que o storage falhe), remove
 * depois. O contrário deixaria uma janela em que o arquivo já era irrecuperável mas o link ainda
 * respondia — o pior dos dois mundos.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { log, logError, logWarn } from '@/lib/logger'

const BUCKET = 'form-uploads'
/** Remoção em lotes: o storage aceita lista, mas uma lista gigante vira timeout. */
const LOTE = 100

type Alvo = { formId?: string; responseId?: string; userId?: string }

/**
 * Revoga e remove os anexos do alvo. NÃO lança: exclusão de conta/formulário não pode falhar
 * porque o storage teve um soluço — o registro fica revogado (link morto) e o objeto é varrido
 * depois. Devolve o que conseguiu fazer, para quem chama registrar.
 */
export async function purgarAnexos(db: SupabaseClient, alvo: Alvo): Promise<{ revogados: number; removidos: number }> {
  try {
    let q = db.from('form_files').select('id, object_path').neq('status', 'deleted')

    if (alvo.responseId) {
      q = q.eq('response_id', alvo.responseId)
    } else if (alvo.formId) {
      q = q.eq('form_id', alvo.formId)
    } else if (alvo.userId) {
      // Conta inteira: alcança pelos formulários do dono. Subconsulta por `in` mantém isto numa
      // ida só e não depende de o caminho carregar o user_id (que é justamente o acoplamento
      // que este redesenho removeu).
      const { data: forms } = await db.from('forms').select('id').eq('user_id', alvo.userId)
      const ids = (forms ?? []).map((f) => (f as { id: string }).id)
      if (!ids.length) return { revogados: 0, removidos: 0 }
      q = q.in('form_id', ids)
    } else {
      return { revogados: 0, removidos: 0 }
    }

    const { data: fichas, error } = await q
    if (error) {
      logError('[purge] falha ao listar anexos — nada removido', error, alvo)
      return { revogados: 0, removidos: 0 }
    }
    const lista = (fichas ?? []) as Array<{ id: string; object_path: string }>
    if (!lista.length) return { revogados: 0, removidos: 0 }

    // 1) REVOGA primeiro. A partir daqui o link responde 404, mesmo que o passo 2 falhe.
    const agora = new Date().toISOString()
    const { error: erroRevoga } = await db
      .from('form_files')
      .update({ status: 'deleted', revoked_at: agora } as never)
      .in('id', lista.map((f) => f.id))
    if (erroRevoga) {
      logError('[purge] falha ao revogar — abortando remoção (link ainda vivo)', erroRevoga, alvo)
      return { revogados: 0, removidos: 0 }
    }

    // 2) REMOVE do storage, em lotes.
    let removidos = 0
    for (let i = 0; i < lista.length; i += LOTE) {
      const caminhos = lista.slice(i, i + LOTE).map((f) => f.object_path)
      const { error: erroRm } = await db.storage.from(BUCKET).remove(caminhos)
      if (erroRm) {
        // Já revogado: o dado não é mais alcançável. Fica para a varredura de órfãos.
        logWarn('[purge] lote não removido do storage (já revogado; varredura pega depois)', {
          quantidade: caminhos.length, erro: erroRm.message,
        })
      } else {
        removidos += caminhos.length
      }
    }

    log('[purge] anexos purgados', { ...alvo, revogados: lista.length, removidos })
    return { revogados: lista.length, removidos }
  } catch (err) {
    logError('[purge] exceção — exclusão principal segue', err, alvo)
    return { revogados: 0, removidos: 0 }
  }
}
