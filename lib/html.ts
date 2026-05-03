import DOMPurifyClient from 'dompurify'

/**
 * Etapa 9 (P0-FB1, P1-FB1, P1-FB2): server-side HTML sanitization with the
 * full DOMPurify (Node.js / jsdom). The previous fallback was an HTML-escape
 * which destroyed legitimate rich-text formatting and was a single line of
 * defense — this module is now the canonical sanitizer used both by API
 * routes (before persisting) and by the form player (defense-in-depth).
 *
 * Whitelist is conservative: only basic block/inline tags + lists + links.
 * Anchor `href` is validated by `isSafeUrl` (https/http/mailto/tel/sms only).
 */

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'a',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'blockquote',
  'pre',
  'code',
  'span',
]

const ALLOWED_ATTR = ['href', 'target', 'rel', 'class']

const SAFE_PROTOCOLS = ['https:', 'http:', 'mailto:', 'tel:', 'sms:']

/**
 * Returns true when `value` is empty or uses an allowed protocol. Blocks
 * `javascript:`, `data:`, `vbscript:`, `blob:`, `ws:`, `wss:`, `file:`, etc.
 */
export function isSafeUrl(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return true
  // Block known dangerous schemes early — covers cases that the URL parser
  // accepts (e.g. `javascript:alert(1)` parses fine).
  if (/^(javascript|data|vbscript|mhtml|x-javascript|file|blob|ws|wss):/i.test(trimmed)) {
    return false
  }
  try {
    const parsed = new URL(trimmed)
    return SAFE_PROTOCOLS.includes(parsed.protocol)
  } catch {
    // Treat relative URLs (no scheme) as safe — the browser resolves them
    // against the current origin.
    return !trimmed.includes(':')
  }
}

let serverPurifier: typeof DOMPurifyClient | null = null

function getServerPurifier(): typeof DOMPurifyClient {
  if (serverPurifier) return serverPurifier
  // Lazy load jsdom so client bundles stay clean.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { JSDOM } = require('jsdom') as typeof import('jsdom')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const factory = require('dompurify') as typeof import('dompurify')
  const window = new JSDOM('').window
  serverPurifier = (factory as unknown as (win: unknown) => typeof DOMPurifyClient)(window)
  return serverPurifier
}

function getPurifier(): typeof DOMPurifyClient {
  if (typeof window === 'undefined') return getServerPurifier()
  return DOMPurifyClient
}

/**
 * Sanitize an arbitrary HTML fragment. Empty/non-string inputs are returned
 * as the empty string so callers can use it unconditionally.
 */
export function sanitizeHtml(dirty: unknown): string {
  if (typeof dirty !== 'string' || !dirty) return ''
  const purifier = getPurifier()
  const cleaned = purifier.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    FORBID_ATTR: ['style', 'srcset', 'onerror', 'onclick', 'onload'],
  })

  // Belt-and-braces: scrub anchor hrefs whose protocol slipped past DOMPurify
  // (e.g. via attribute mutation hooks). DOMPurify already drops dangerous
  // schemes, but we double-check before returning.
  if (typeof cleaned !== 'string') return ''
  return cleaned.replace(/href="([^"]*)"/g, (full, href) =>
    isSafeUrl(href) ? full : 'href="#"'
  )
}

/**
 * For form questions of type `content_block`, sanitize the rich-text body and
 * the call-to-action URL so we never persist active script payloads.
 */
export function sanitizeContentBlocks<T>(questions: T): T {
  if (!Array.isArray(questions)) return questions
  return questions.map((q) => {
    if (!q || typeof q !== 'object') return q
    const obj = q as Record<string, unknown>
    if (obj.type !== 'content_block') return q
    const next: Record<string, unknown> = { ...obj }
    if (typeof obj.contentBody === 'string') {
      next.contentBody = sanitizeHtml(obj.contentBody)
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
