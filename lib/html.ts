import DOMPurify from 'dompurify'

/**
 * Shared HTML utilities — safe for both server and client.
 * - isSafeUrl, escapeHtml: pure functions, no dependencies
 * - sanitizeHtml: uses DOMPurify (browser DOM on client, jsdom on server via html-server.ts)
 *
 * Server routes should import sanitizeHtmlServer from './html-server' instead.
 * This file is imported by client components and must NOT reference jsdom/Node APIs.
 */

export const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'a',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'blockquote', 'pre', 'code', 'span',
]

export const ALLOWED_ATTR = ['href', 'target', 'rel', 'class']

const SAFE_PROTOCOLS = ['https:', 'http:', 'mailto:', 'tel:', 'sms:']

/**
 * Returns true when `value` is empty or uses an allowed protocol.
 */
export function isSafeUrl(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return true
  if (/^(javascript|data|vbscript|mhtml|x-javascript|file|blob|ws|wss):/i.test(trimmed)) {
    return false
  }
  try {
    const parsed = new URL(trimmed)
    return SAFE_PROTOCOLS.includes(parsed.protocol)
  } catch {
    return !trimmed.includes(':')
  }
}

/**
 * Client-side HTML sanitization using browser DOMPurify.
 * For server-side sanitization, use sanitizeHtmlServer from './html-server'.
 */
export function sanitizeHtml(dirty: unknown): string {
  if (typeof dirty !== 'string' || !dirty) return ''
  const cleaned = DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    FORBID_ATTR: ['style', 'srcset', 'onerror', 'onclick', 'onload'],
  })
  if (typeof cleaned !== 'string') return ''
  return cleaned.replace(/href="([^"]*)"/g, (full, href) =>
    isSafeUrl(href) ? full : 'href="#"'
  )
}

/**
 * Whitelist de propriedades CSS permitidas no `style=` (rich mode).
 * Cada valor tem um regex que valida o conteúdo aceitável — qualquer coisa
 * fora dos formatos esperados é descartada. Bloqueia url(), expression()
 * e prefixos javascript: independentemente da propriedade.
 */
const SAFE_STYLE_PROPS: Record<string, RegExp> = {
  'font-size': /^\d+(\.\d+)?(px|em|rem|%)$/,
  'font-weight': /^(normal|bold|bolder|lighter|[1-9]00)$/i,
  'font-style': /^(normal|italic|oblique)$/i,
  'text-align': /^(left|right|center|justify|start|end)$/i,
  'text-decoration': /^(none|underline|line-through|overline)( (none|underline|line-through|overline))*$/i,
  color: /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)|[a-z]+)$/i,
}

/**
 * Filtra uma string `style="..."` mantendo apenas declarações cuja
 * propriedade está em SAFE_STYLE_PROPS e cujo valor passa pela validação.
 * Retorna a string filtrada (vazia se nada sobrou).
 */
export function filterSafeStyle(rawStyle: string): string {
  if (!rawStyle || typeof rawStyle !== 'string') return ''
  const out: string[] = []
  for (const decl of rawStyle.split(';')) {
    const colonIdx = decl.indexOf(':')
    if (colonIdx < 0) continue
    const prop = decl.slice(0, colonIdx).trim().toLowerCase()
    const value = decl.slice(colonIdx + 1).trim()
    if (!prop || !value) continue
    if (value.length > 64) continue
    if (/url\s*\(|expression\s*\(|javascript\s*:/i.test(value)) continue
    const validator = SAFE_STYLE_PROPS[prop]
    if (!validator) continue
    if (!validator.test(value)) continue
    out.push(`${prop}: ${value}`)
  }
  return out.join('; ')
}

/**
 * "Rich" sanitization — igual a sanitizeHtml, mas mantém `style=` com
 * propriedades safelistadas (font-size, font-weight, color, text-align,
 * etc.). Usado pra renderizar content_block: o builder gera Tiptap com
 * inline styles (FontSize, etc.) que precisam sobreviver à sanitização.
 */
export function sanitizeRichHtml(dirty: unknown): string {
  if (typeof dirty !== 'string' || !dirty) return ''
  // Hook local: valida cada style encontrado e descarta o atributo se nada
  // sobrar. Removido no finally pra não vazar entre chamadas.
  const hook = (_node: Element, data: { attrName: string; attrValue: string; keepAttr: boolean }) => {
    if (data.attrName === 'style') {
      const safe = filterSafeStyle(data.attrValue)
      if (safe) data.attrValue = safe
      else data.keepAttr = false
    }
  }
  DOMPurify.addHook('uponSanitizeAttribute', hook)
  try {
    const cleaned = DOMPurify.sanitize(dirty, {
      ALLOWED_TAGS,
      ALLOWED_ATTR: [...ALLOWED_ATTR, 'style'],
      ALLOW_DATA_ATTR: false,
      FORBID_ATTR: ['srcset', 'onerror', 'onclick', 'onload'],
    })
    if (typeof cleaned !== 'string') return ''
    return cleaned.replace(/href="([^"]*)"/g, (full, href) =>
      isSafeUrl(href) ? full : 'href="#"'
    )
  } finally {
    DOMPurify.removeHook('uponSanitizeAttribute')
  }
}

export function sanitizeContentBlocks<T>(questions: T): T {
  if (!Array.isArray(questions)) return questions
  return questions.map((q) => {
    if (!q || typeof q !== 'object') return q
    const obj = q as Record<string, unknown>
    if (obj.type !== 'content_block') return q
    const next: Record<string, unknown> = { ...obj }
    if (typeof obj.contentBody === 'string') {
      // Rich mode: preserva tamanho/peso/cor/alinhamento que o Tiptap aplica
      // via inline style. O sanitizeHtml comum apagava esses estilos.
      next.contentBody = sanitizeRichHtml(obj.contentBody)
    }
    if (typeof obj.contentButtonUrl === 'string' && !isSafeUrl(obj.contentButtonUrl)) {
      next.contentButtonUrl = ''
    }
    return next
  }) as unknown as T
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
