/**
 * lib/form-file-claim.ts — a prova de que o anexo é DESTE formulário.
 *
 * O buraco que isto fecha existia ANTES do redesenho de anexos privados e não seria corrigido
 * por ele: `validateFileUpload` só conferia se a URL começava com o prefixo do bucket. Como o
 * bucket é UM para todos os clientes, bastava pegar o endereço de um anexo de um formulário e
 * gravá-lo como resposta de OUTRO — o servidor aceitava.
 *
 * Quem assina o upload já amarra caminho → dono → formulário → pergunta
 * (`app/api/upload/sign-url/route.ts`). O que faltava era conferir esse vínculo na GRAVAÇÃO.
 *
 * Regra: o navegador manda uma REFERÊNCIA (`file_id`); quem monta a URL é o servidor, depois de
 * provar o vínculo. Assim não existe URL vinda do cliente para confiar ou desconfiar.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { urlDoArquivo } from '@/lib/file-link-token'
import { log, logError, logWarn } from '@/lib/logger'

/** Falha de INFRAESTRUTURA ao conferir o anexo — distinta de referência inválida. */
export class ErroAoConferirAnexo extends Error {
  constructor(motivo: string) {
    super(`falha ao conferir anexo: ${motivo}`)
    this.name = 'ErroAoConferirAnexo'
  }
}

type Json = Record<string, unknown>

/**
 * Nome de arquivo seguro para viajar no `Content-Disposition` da URL assinada.
 *
 * O nome vem do NAVEGADOR — é dado do respondente, não nosso. O SDK do storage o concatena na
 * query com `encodeURI`, que NÃO escapa `&`, `#` nem `?` como valor de parâmetro: um arquivo
 * chamado `a&x=1.pdf` quebraria ou alteraria a query. Aspas e quebras de linha quebrariam o
 * próprio cabeçalho. Tiramos os perigosos e preservamos o resto, inclusive acento.
 */
function nomeSeguroDeArquivo(bruto: string): string {
  return bruto
    .replace(/[\r\n\t]/g, ' ')
    .replace(/["'\\]/g, '')
    .replace(/[&#?%;]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

/** Um anexo entre as respostas: `{ name, file_id, ... }` (novo) ou `{ name, url }` (legado). */
function ehAnexo(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v) &&
    typeof (v as Json).name === 'string' &&
    (typeof (v as Json).file_id === 'string' || typeof (v as Json).url === 'string')
}

/**
 * Percorre as respostas, PROVA cada anexo contra a ficha e devolve o objeto que será gravado —
 * já com a URL montada pelo servidor.
 *
 * Anexo que não passa é REMOVIDO da resposta, não rejeitado: derrubar o envio inteiro por causa
 * de um anexo suspeito puniria o lead por um ataque que não é dele. O que ele preencheu é
 * gravado; o anexo some e o caso vira log.
 */
export async function reivindicarAnexos(
  db: SupabaseClient,
  params: { formId: string; responseId: string | null; answers: Json },
): Promise<Json> {
  const { formId, responseId, answers } = params

  const referencias: Array<{ questionId: string; fileId: string }> = []
  for (const [questionId, valor] of Object.entries(answers)) {
    if (ehAnexo(valor) && typeof valor.file_id === 'string') {
      referencias.push({ questionId, fileId: valor.file_id })
    }
  }
  if (!referencias.length) return answers

  const { data: fichas, error } = await db
    .from('form_files')
    .select('id, form_id, question_id, status, revoked_at')
    .in('id', referencias.map((r) => r.fileId))

  if (error) {
    // FALHA DE INFRA ≠ ATAQUE (16/08, parecer Codex). Antes eu apagava os anexos aqui — a mesma
    // reação de quando a referência é forjada. Mas um soluço de banco não torna o anexo do lead
    // suspeito: descartá-lo em silêncio grava uma resposta incompleta e devolve 200, e o lead vê
    // "enviado". Lançar deixa quem chama decidir (o submit final devolve 503 retentável; o
    // autosave engole e tenta de novo no próximo).
    logError('[anexo] não foi possível conferir as fichas — deixando o chamador decidir', error, { formId })
    throw new ErroAoConferirAnexo(error.message ?? 'falha ao consultar form_files')
  }

  const porId = new Map((fichas ?? []).map((f) => [(f as { id: string }).id, f as {
    id: string; form_id: string; question_id: string | null; status: string; revoked_at: string | null
  }]))

  // A versão de acesso do formulário entra na URL — é ela que permite matar links depois.
  const { data: form } = await db
    .from('forms')
    .select('file_access_version')
    .eq('id', formId)
    .maybeSingle()
  const versao = (form as { file_access_version?: number } | null)?.file_access_version ?? 1

  const saida: Json = { ...answers }
  const aReivindicar: string[] = []

  for (const { questionId, fileId } of referencias) {
    const ficha = porId.get(fileId)
    const anexo = answers[questionId] as Json

    const vinculoOk =
      ficha &&
      ficha.form_id === formId &&          // é DESTE formulário
      ficha.question_id === questionId &&  // e DESTA pergunta
      !ficha.revoked_at &&
      (ficha.status === 'pending' || ficha.status === 'ready' || ficha.status === 'claimed')

    if (!vinculoOk) {
      logWarn('[anexo] referência recusada — vínculo não confere', {
        formId, questionId,
        motivo: !ficha ? 'ficha inexistente'
          : ficha.form_id !== formId ? 'arquivo de OUTRO formulário'
          : ficha.question_id !== questionId ? 'arquivo de outra pergunta'
          : ficha.revoked_at ? 'revogado' : `status ${ficha.status}`,
      })
      delete saida[questionId]
      continue
    }

    // NOME ORIGINAL (16/08): sem isto o cliente baixava "7b20c2a1-....jpg" em vez de
    // "curriculo.pdf" — o nome nunca era gravado em lugar nenhum. É o `Content-Disposition`
    // da URL assinada que usa este campo.
    const nomeLimpo = nomeSeguroDeArquivo(String(anexo.name ?? ''))
    if (nomeLimpo) {
      await db.from('form_files').update({ original_name: nomeLimpo } as never).eq('id', fileId)
    }

    const url = urlDoArquivo(fileId, versao)
    saida[questionId] = {
      name: anexo.name,
      type: anexo.type,
      size: anexo.size,
      file_id: fileId,
      // A URL é montada AQUI, pelo servidor. Ela vai para as seis saídas (painel, planilha,
      // webhook, e-mail, WhatsApp, export) — por isso continua no objeto: assim nenhum dos seis
      // precisa saber que o mundo mudou.
      ...(url ? { url } : {}),
    }
    aReivindicar.push(fileId)
  }

  if (aReivindicar.length) {
    const { error: erroClaim } = await db
      .from('form_files')
      .update({
        status: 'claimed',
        response_id: responseId,
        claimed_at: new Date().toISOString(),
      } as never)
      .in('id', aReivindicar)
    if (erroClaim) {
      // Não bloqueia: a resposta já é válida e a URL já é servível. O arquivo fica 'pending' e
      // a varredura de órfãos decide depois — melhor um registro atrasado que uma resposta perdida.
      logWarn('[anexo] falha ao marcar como reivindicado (não bloqueante)', { erro: erroClaim.message })
    } else {
      log('[anexo] reivindicados', { formId, quantidade: aReivindicar.length })
    }
  }

  return saida
}

/**
 * Amarra os anexos à resposta DEPOIS que ela existe.
 *
 * Por que em dois tempos: no submit, a prova do vínculo tem de acontecer ANTES de gravar (senão
 * grava-se lixo), mas o id da resposta só existe DEPOIS. Antes desta correção eu passava
 * `responseId: null` e nunca voltava — então toda ficha ficava com `response_id` nulo e a purga
 * por resposta jamais acharia nada. (Parecer Codex, 16/08.)
 */
export async function vincularAnexosAResposta(
  db: SupabaseClient,
  params: { answers: Json; responseId: string },
): Promise<void> {
  const ids = Object.values(params.answers)
    .filter(ehAnexo)
    .map((v) => v.file_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (!ids.length) return
  const { error } = await db
    .from('form_files')
    .update({ response_id: params.responseId } as never)
    .in('id', ids)
  if (error) {
    // Não bloqueia: a resposta é válida e o link funciona. O que se perde é a purga POR RESPOSTA
    // achar este arquivo — a purga por formulário/conta continua alcançando.
    logWarn('[anexo] falha ao vincular à resposta (não bloqueante)', { responseId: params.responseId })
  }
}
