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
