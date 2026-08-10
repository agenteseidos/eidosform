import { checkResponseRateLimitAsync } from '@/lib/response-rate-limit'
import { NON_ANSWER_QUESTION_TYPES } from '@/lib/answer-format'
import { buildQuestionPath } from '@/lib/form-logic-engine'

const MAX_PAYLOAD_BYTES = 50 * 1024
const MAX_ANSWER_KEYS = 200

export { MAX_PAYLOAD_BYTES, MAX_ANSWER_KEYS }

/**
 * NOME DE TAG DE VERDADE: `<` (ou `</`) colado numa LETRA, seguido de letras/dígitos/hífen, e
 * terminado por espaço, `/` ou `>`.
 *
 * A regra antiga era `<[^>]*>` — "qualquer coisa entre menor e maior". Foi ela que apagava
 * `<joao@empresa.com>`, `ganho < 5k e gasto > 2k` e `x<3 e y>4`.
 *
 * O `[\s/]` no terminador NÃO é detalhe: o tokenizer do HTML5 aceita a barra como fim do nome da
 * tag, igual a espaço. Uma regra que só aceitasse `\s` deixaria `<img/src=x/onerror=alert(1)>` e
 * `<svg/onload=alert(1)>` passarem INTEIROS — consertar o e-mail teria aberto uma brecha.
 */
const HTML_TAG = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:[\s/][^>]*)?>/g

/**
 * Decodifica SÓ o que pode virar `<` ou `>`, nomeado e numérico.
 *
 * `&amp;` e `&quot;` ficaram DE FORA de propósito: nenhum destino faz parsing depois desta função,
 * então decodificá-los só alterava o texto literal do lead — e era a origem da não-idempotência
 * (`&amp;lt;3` dava `&lt;3` na 1ª passada e `<3` na 2ª).
 *
 * O numérico (`&#60;`) entrou agora. Ele DEVERIA ser tratado antes, mas o trecho que fazia isso
 * vivia dentro de um callback que só capturava entidades nomeadas — nunca executou. Resultado:
 * `&#60;script&#62;` passava intacto nas quatro rotas desde sempre.
 */
function decodeAngleEntities(s: string): string {
  return s
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#0*60;?/g, '<').replace(/&#x0*3c;?/gi, '<')
    .replace(/&#0*62;?/g, '>').replace(/&#x0*3e;?/gi, '>')
}

/**
 * Laço até PONTO FIXO — mesmo padrão já usado em `lib/html-server.ts:104-113`.
 *
 * Uma passada só reconstitui tag por aninhamento: `<scr<script>ipt>` vira `<script>`, uma tag VIVA
 * que não existia na entrada. Repetir até estabilizar fecha isso e também a dupla codificação.
 * O teto de 5 voltas é guarda contra entrada patológica; na prática estabiliza em 1 ou 2.
 */
function sanitizeString(input: string): string {
  let out = input
  for (let i = 0; i < 5; i++) {
    const prev = out
    out = decodeAngleEntities(out).replace(HTML_TAG, '')
    if (out === prev) break
  }
  return out
}

/**
 * Limpeza aplicada a TODA resposta de TODO formulário, nas quatro rotas de gravação.
 *
 * ⚠️ Esta é a FONTE ÚNICA (auditoria 2026-08, lote 5). Existiam TRÊS versões divergentes dela em
 * quatro rotas, com segurança desigual: `&lt;script&gt;` era neutralizado numa e passava INTACTO
 * em outra — o mesmo formulário se protegia de um jeito ou de outro conforme o endpoint que
 * recebeu a resposta. `lib/rotas-irmas.test.ts` tem uma regra que falha se alguém recriar uma cópia.
 */
export function sanitizeValue(val: unknown): unknown {
  if (typeof val === 'string') {
    return sanitizeString(val)
  }
  if (Array.isArray(val)) return val.map(sanitizeValue)
  if (val && typeof val === 'object') {
    return Object.fromEntries(
      Object.entries(val as Record<string, unknown>).map(([k, v]) => [k, sanitizeValue(v)])
    )
  }
  return val
}

export function isResponseComplete(
  answers: Record<string, unknown>,
  questions: Array<{ id: string; type?: string; required?: boolean }>
): boolean {
  // Considera só o caminho efetivamente percorrido — ramos escondidos por
  // lógica condicional não devem invalidar uma resposta que terminou o
  // sub-fluxo do respondente (ex.: lead que cai num content_block de saída
  // antecipada após filtragem por idade).
  const path = buildQuestionPath(
    questions as unknown as Parameters<typeof buildQuestionPath>[0],
    answers,
  )
  const pathSet = path.length > 0 ? new Set(path) : null
  // `html_block` entra junto com `content_block` (auditoria 2026-08, lote 5).
  // Os dois são BLOCOS DE CONTEÚDO: não recebem resposta. Só `content_block` era excluído aqui, e
  // por isso um `html_block` marcado como obrigatório tornava a resposta eternamente incompleta —
  // e "incompleta" é o portão único de e-mail, WhatsApp, planilha, pixel e webhook. O formulário
  // travava para sempre, e nem recarregar resolvia.
  const required = questions.filter((q) => q.required && !(q.type && NON_ANSWER_QUESTION_TYPES.has(q.type)))
  if (required.length === 0) return true
  const requiredInPath = pathSet
    ? required.filter((q) => pathSet.has(q.id))
    : required
  if (requiredInPath.length === 0) return true
  return requiredInPath.every((q) => {
    const val = answers[q.id]
    if (val === undefined || val === null || val === '') return false
    if (Array.isArray(val) && val.length === 0) return false
    return true
  })
}

export function getClientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
}

export async function checkSubmissionRateLimit(req: Request) {
  return checkResponseRateLimitAsync(getClientIp(req))
}
