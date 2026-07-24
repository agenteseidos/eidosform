/**
 * Formatter de domínio para VALORES DE RESPOSTA de formulário.
 *
 * Motivação (auditoria Codex 2026-07-23): respostas de alguns tipos são OBJETOS
 * (file_upload = {name,type,size,url}; address = {cep,rua,numero,...}) e os
 * consumidores faziam String(value) → "[object Object]" (WhatsApp, CSV) ou JSON
 * cru (XLSX/PDF/Sheets). Este módulo é a ÚNICA fonte de formatação humana.
 *
 * Sinks:
 *  - 'whatsapp': multi-linha, com emoji (📎/✅) — vai pra notificação de lead.
 *  - 'export':   linha única, sem emoji — CSV/XLSX/PDF/Sheets. A sanitização
 *                anti-injeção (sanitizeCellValue) continua sendo aplicada POR
 *                CADA export DEPOIS desta formatação (decisão Codex).
 *
 * NUNCA devolve "[object Object]": objeto desconhecido vira "chave: valor" legível.
 */

export type AnswerSink = 'whatsapp' | 'export'

export interface FormatAnswerOptions {
  sink?: AnswerSink
  /** Tipo canônico da pergunta (lib/questions.ts), quando o chamador souber. */
  questionType?: string
}

interface FileAnswer { name?: unknown; url?: unknown; size?: unknown; type?: unknown }

const ADDRESS_KEYS = ['cep', 'rua', 'numero', 'complemento', 'bairro', 'cidade', 'estado'] as const

function isFileAnswer(v: unknown): v is FileAnswer {
  return !!v && typeof v === 'object' && !Array.isArray(v) &&
    typeof (v as FileAnswer).url === 'string' &&
    ('name' in (v as object) || 'size' in (v as object) || 'type' in (v as object))
}

function isAddressAnswer(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const keys = Object.keys(v as object)
  if (keys.length === 0) return false
  // endereço = só chaves conhecidas de endereço (≥2 presentes)
  const known = keys.filter((k) => (ADDRESS_KEYS as readonly string[]).includes(k))
  return known.length >= 2 && known.length === keys.length
}

function isCalendlyAnswer(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v) &&
    ('event_uri' in (v as object) || 'invitee_uri' in (v as object))
}

const isCalendlyUri = (s: string) =>
  s === 'scheduled' || /^https:\/\/(api\.)?calendly\.com\//.test(s)

// `api.calendly.com/...` é ENDPOINT DE API (exige token; abrir no navegador devolve
// "Unauthenticated") — NUNCA é link clicável pro vendedor. Só tratamos como link útil
// uma página calendly.com VIEWÁVEL (ex.: reschedule/cancel do invitee). Hoje o widget
// só captura a URI de API, então na prática o WhatsApp mostra apenas o "✅". Enriquecer
// com data/hora real do agendamento = feature futura (precisa credencial da API Calendly).
const isViewableCalendlyUrl = (s: string) =>
  /^https:\/\/(?!api\.)([a-z0-9-]+\.)?calendly\.com\//i.test(s)

function formatFile(v: FileAnswer, sink: AnswerSink): string {
  const name = typeof v.name === 'string' && v.name.trim() ? v.name.trim() : ''
  const url = typeof v.url === 'string' ? v.url.trim() : ''
  if (sink === 'whatsapp') {
    if (name && url) return `📎 ${name}\n${url}`
    return `📎 ${name || url}`
  }
  if (name && url) return `${name} (${url})`
  return name || url
}

function formatAddress(v: Record<string, unknown>, _sink: AnswerSink): string {
  const g = (k: string) => {
    const raw = v[k]
    return typeof raw === 'string' ? raw.trim() : raw != null ? String(raw).trim() : ''
  }
  const ruaNumero = [g('rua'), g('numero')].filter(Boolean).join(', ')
  const comComplemento = [ruaNumero, g('complemento')].filter(Boolean).join(' - ')
  const cidadeUf = [g('cidade'), g('estado')].filter(Boolean).join('/')
  const cep = g('cep') ? `CEP ${g('cep')}` : ''
  return [comComplemento, g('bairro'), cidadeUf, cep].filter(Boolean).join(', ')
}

function formatCalendly(uri: string, sink: AnswerSink): string {
  if (sink === 'whatsapp') {
    // WhatsApp é pra ação humana imediata: só anexa link se for VIEWÁVEL. URI de API
    // (o único formato que o widget captura hoje) é omitida — link quebrado engana o
    // vendedor. Sem link viewável, "✅ Agendamento realizado" já basta: o Calendly
    // manda a confirmação com data/hora por conta própria pro dono do form.
    const link = uri && uri !== 'scheduled' && isViewableCalendlyUrl(uri) ? uri : ''
    return link ? `✅ Agendamento realizado\n${link}` : '✅ Agendamento realizado'
  }
  // Export é registro/rastreabilidade — mantém a URI (mesmo de API), que dá pra
  // resolver depois via API. Ninguém "clica" numa célula de planilha.
  const record = uri && uri !== 'scheduled' ? uri : ''
  return record ? `Agendamento realizado (${record})` : 'Agendamento realizado'
}

/** Fallback seguro pra objeto desconhecido: "chave: valor" legível, nunca [object Object]. */
function formatUnknownObject(v: Record<string, unknown>, sink: AnswerSink, depth: number): string {
  const parts = Object.entries(v)
    .filter(([, val]) => val !== null && val !== undefined && val !== '')
    .map(([k, val]) => `${k}: ${formatAtDepth(val, { sink }, depth + 1)}`)
  return parts.join(', ')
}

/**
 * P2-6 (2ª auditoria Codex): a recursão não tinha teto. Um objeto/array aninhado
 * malformado (ou hostil) podia estourar a pilha ou gerar uma mensagem
 * desproporcional — e, no cron, derrubar o LOTE INTEIRO junto. Teto de
 * profundidade + de tamanho: degradação previsível em vez de exceção.
 */
const MAX_DEPTH = 6
const MAX_OUTPUT_CHARS = 4000

export function formatAnswerValue(value: unknown, opts: FormatAnswerOptions = {}): string {
  const out = formatAtDepth(value, opts, 0)
  return out.length > MAX_OUTPUT_CHARS ? `${out.slice(0, MAX_OUTPUT_CHARS)}…` : out
}

function formatAtDepth(value: unknown, opts: FormatAnswerOptions, depth: number): string {
  const sink: AnswerSink = opts.sink ?? 'whatsapp'
  if (depth > MAX_DEPTH) return '…'

  if (value === null || value === undefined) return ''
  if (typeof value === 'string') {
    const s = value.trim()
    if (opts.questionType === 'calendly' || isCalendlyUri(s)) return s ? formatCalendly(s, sink) : ''
    return s
  }
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (Array.isArray(value)) {
    const items = value.map((v) => formatAtDepth(v, opts, depth + 1)).filter(Boolean)
    // arquivos múltiplos: um por linha no WhatsApp; demais listas: vírgula
    const multiline = sink === 'whatsapp' && value.some(isFileAnswer)
    return items.join(multiline ? '\n' : ', ')
  }
  if (typeof value === 'object') {
    if (isFileAnswer(value)) return formatFile(value, sink)
    if (isCalendlyAnswer(value)) {
      const uri = String((value as Record<string, unknown>).event_uri ?? '')
      return formatCalendly(uri || 'scheduled', sink)
    }
    if (isAddressAnswer(value)) return formatAddress(value, sink)
    return formatUnknownObject(value as Record<string, unknown>, sink, depth)
  }
  return String(value)
}

/** Tipos de bloco que NÃO são dados de lead — omitidos das notificações. */
export const NON_ANSWER_QUESTION_TYPES = new Set(['html_block', 'content_block'])
