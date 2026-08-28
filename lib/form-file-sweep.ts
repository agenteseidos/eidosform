import type { SupabaseClient } from '@supabase/supabase-js'
import { log, logWarn } from '@/lib/logger'

/**
 * lib/form-file-sweep.ts — a varredura de órfãos que o código PROMETIA e não existia.
 *
 * Dois comentários diziam "fica para a varredura de órfãos" (`form-file-purge.ts`,
 * `form-file-claim.ts`) e a auditoria de 27/08/2026 descobriu que **ela nunca foi escrita**.
 * Promessa em comentário é o mesmo que promessa em documento: não roda.
 *
 * DOIS TIPOS DE ÓRFÃO, com causas diferentes:
 *
 *  A) FICHA REVOGADA, OBJETO VIVO — a purga revogou (link morto) mas o `remove()` do storage
 *     falhou. O dado está inalcançável pelo produto, mas continua ocupando espaço e existindo
 *     de fato. A política de privacidade publicada promete deleção; revogar não é deletar.
 *
 *  B) OBJETO SEM FICHA NENHUMA — o formulário foi apagado e o cascade levou as linhas de
 *     `form_files` junto, sem ninguém ter removido o objeto. Foi exatamente o que aconteceu
 *     entre 17/08 e 27/08, quando o DELETE deixou de purgar (o bloco tinha ido parar no PATCH).
 *     Este é o órfão INVISÍVEL: não há registro dele em lugar nenhum do banco.
 *
 * ⚠️ A ficha nasce ANTES do objeto (o `sign-url` insere `pending` junto com a URL assinada),
 * então "objeto sem ficha" é órfão de verdade — não uma corrida de upload em andamento.
 * Ainda assim exigimos IDADE MÍNIMA: um objeto recém-criado cuja ficha foi apagada no mesmo
 * segundo é improvável, mas o custo de esperar é zero e o de apagar cedo é irreversível.
 */

const BUCKET = 'form-uploads'
/** Não toca em objeto mais novo que isto. Apagar cedo é irreversível; esperar não custa nada. */
export const IDADE_MINIMA_MS = 24 * 60 * 60 * 1000
/** Teto por rodada: varredura é faxina, não corrida. O que sobrar sai na próxima. */
export const TETO_POR_RODADA = 200

export type Orfao = { caminho: string; motivo: 'ficha_revogada' | 'sem_ficha'; idadeMs: number }

/**
 * DECISÃO PURA — dado o inventário, o que é órfão? Sem I/O, testável de verdade.
 *
 * Um objeto só é órfão quando **não existe nenhuma ficha viva** apontando para ele. Uma ficha
 * viva (`pending`/`ready`/`claimed`) protege o objeto, mesmo que OUTRA ficha revogada aponte
 * para o mesmo caminho — é o caso do arquivo enviado em duas respostas, em que uma foi excluída
 * e a outra continua de pé (achado do teste real de 18/08, já tratado na purga).
 */
export function decidirOrfaos(params: {
  objetos: Array<{ caminho: string; criadoEm: number }>
  fichas: Array<{ object_path: string; status: string }>
  agora?: number
  idadeMinimaMs?: number
}): Orfao[] {
  const agora = params.agora ?? Date.now()
  const idadeMinima = params.idadeMinimaMs ?? IDADE_MINIMA_MS

  const vivas = new Set(
    params.fichas.filter((f) => f.status !== 'deleted').map((f) => f.object_path),
  )
  const revogadas = new Set(
    params.fichas.filter((f) => f.status === 'deleted').map((f) => f.object_path),
  )

  const orfaos: Orfao[] = []
  for (const o of params.objetos) {
    if (vivas.has(o.caminho)) continue // protegido por ficha viva — NUNCA remover
    const idadeMs = agora - o.criadoEm
    if (idadeMs < idadeMinima) continue // novo demais: espera a próxima rodada
    orfaos.push({
      caminho: o.caminho,
      motivo: revogadas.has(o.caminho) ? 'ficha_revogada' : 'sem_ficha',
      idadeMs,
    })
  }
  return orfaos
}

/** Lista recursiva do bucket (o storage lista por pasta; os caminhos são user/form/arquivo). */
export async function inventariarObjetos(
  db: SupabaseClient,
  prefixo = '',
  profundidade = 0,
): Promise<Array<{ caminho: string; criadoEm: number }>> {
  if (profundidade > 3) return [] // user/form/arquivo — mais que isso é estrutura inesperada
  const { data, error } = await db.storage.from(BUCKET).list(prefixo, { limit: 1000 })
  if (error || !data) {
    logWarn('[sweep] falha ao listar pasta — ignorada nesta rodada', { prefixo, erro: error?.message })
    return []
  }
  const saida: Array<{ caminho: string; criadoEm: number }> = []
  for (const item of data) {
    const caminho = prefixo ? `${prefixo}/${item.name}` : item.name
    // Pasta: o storage devolve entrada sem `id`. Arquivo tem id e metadata.
    if (!item.id) {
      saida.push(...(await inventariarObjetos(db, caminho, profundidade + 1)))
    } else {
      const criadoEm = Date.parse(item.created_at ?? '') || Date.now()
      saida.push({ caminho, criadoEm })
    }
  }
  return saida
}
