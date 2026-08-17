/**
 * lib/file-link-token.ts — o crachá do anexo.
 *
 * O QUE ELE **NÃO** CARREGA, de propósito: caminho no storage, id do dono, nome do arquivo,
 * modo de acesso. Tudo isso é lido do banco NA HORA do acesso. Foi a correção central do parecer
 * independente (16/08) sobre o desenho que eu tinha proposto: um HMAC do caminho funcionaria hoje
 * e quebraria amanhã — não permite revogar, não permite expirar, e uma transferência de
 * formulário faria o link apontar para o dono errado.
 *
 * O token carrega só DUAS coisas:
 *  · `fileId`  — a ficha a consultar;
 *  · `versao`  — a versão de acesso do FORMULÁRIO no momento em que o link foi emitido.
 *
 * A versão é o que mata link já distribuído. Quando o dono troca o formulário de "qualquer pessoa
 * com o link" para "somente eu", a versão do formulário sobe — e todo link emitido antes passa a
 * não bater. Sem mover arquivo, sem varrer planilha, sem depender de expiração.
 *
 * ⚠️ Segredo DEDICADO (`FILE_LINK_SECRET`), sem cadeia de fallback. Já tomamos essa lição duas
 * vezes neste projeto: o token do /pagar caía no INTERNAL_API_SECRET e o de opt-out reaproveitava
 * o mesmo. Link público e rota interna não têm motivo para compartilhar raio de dano.
 */
import { createHmac, timingSafeEqual } from 'crypto'

/** Prefixo de versão do FORMATO do token — permite trocar o esquema sem ambiguidade. */
const V = 'v1'

function segredo(): string {
  return process.env.FILE_LINK_SECRET || ''
}

const b64url = (s: string): string => Buffer.from(s, 'utf8').toString('base64url')
const deB64url = (s: string): string => Buffer.from(s, 'base64url').toString('utf8')

/**
 * Emite o crachá. `null` quando não há segredo — quem chama trata como "sem link" e degrada
 * (o painel some com o botão, a planilha recebe o nome sem endereço). Falhar fechado aqui é
 * melhor que emitir um token que ninguém consegue validar depois.
 */
export function assinarFileToken(fileId: string, versao: number): string | null {
  const s = segredo()
  if (!s || !fileId || !Number.isInteger(versao)) return null
  const corpo = b64url(`${V}.${fileId}.${versao}`)
  const assinatura = createHmac('sha256', s).update(corpo).digest('base64url')
  return `${corpo}.${assinatura}`
}

export type FileTokenLido =
  | { ok: true; fileId: string; versao: number }
  | { ok: false; motivo: 'sem_segredo' | 'formato' | 'assinatura' }

/** Lê e CONFERE. Nunca devolve dado de um token cuja assinatura não bate. */
export function lerFileToken(token: string): FileTokenLido {
  const s = segredo()
  if (!s) return { ok: false, motivo: 'sem_segredo' }
  if (typeof token !== 'string' || !token.includes('.')) return { ok: false, motivo: 'formato' }

  const i = token.lastIndexOf('.')
  const corpo = token.slice(0, i)
  const assinatura = token.slice(i + 1)
  if (!corpo || !assinatura) return { ok: false, motivo: 'formato' }

  const esperada = createHmac('sha256', s).update(corpo).digest('base64url')
  // Comparação em tempo constante: sem isto, o tempo de resposta entrega a assinatura byte a byte.
  const a = Buffer.from(assinatura)
  const b = Buffer.from(esperada)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, motivo: 'assinatura' }

  let bruto: string
  try {
    bruto = deB64url(corpo)
  } catch {
    return { ok: false, motivo: 'formato' }
  }
  const partes = bruto.split('.')
  if (partes.length !== 3 || partes[0] !== V) return { ok: false, motivo: 'formato' }
  const versao = Number(partes[2])
  if (!Number.isInteger(versao)) return { ok: false, motivo: 'formato' }
  return { ok: true, fileId: partes[1], versao }
}

/** A URL que vai para a planilha, o e-mail, o CRM e o painel. Permanente e nossa. */
export function urlDoArquivo(fileId: string, versao: number): string | null {
  const token = assinarFileToken(fileId, versao)
  if (!token) return null
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://eidosform.com.br'
  return `${base}/arquivo/${token}`
}

/** Prefixo canônico — o validador usa para reconhecer um anexo nosso. */
export function prefixoUrlArquivo(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://eidosform.com.br'
  return `${base}/arquivo/`
}
