import createDOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'
import { isSafeUrl, ALLOWED_TAGS, ALLOWED_ATTR } from './html'

/**
 * Server-only HTML sanitization using jsdom + DOMPurify.
 * DO NOT import from client components — jsdom requires Node.js 'fs'.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let purifier: any = null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPurifier(): any {
  if (purifier) return purifier
  const window = new JSDOM('').window
  purifier = createDOMPurify(window as any)
  return purifier
}

export function sanitizeHtmlServer(dirty: unknown): string {
  if (typeof dirty !== 'string' || !dirty) return ''
  const p = getPurifier()
  const cleaned = p.sanitize(dirty, {
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

export function sanitizeContentBlocksServer<T>(questions: T): T {
  if (!Array.isArray(questions)) return questions
  return questions.map((q) => {
    if (!q || typeof q !== 'object') return q
    const obj = q as Record<string, unknown>
    if (obj.type !== 'content_block') return q
    const next: Record<string, unknown> = { ...obj }
    if (typeof obj.contentBody === 'string') {
      next.contentBody = sanitizeHtmlServer(obj.contentBody)
    }
    if (typeof obj.contentButtonUrl === 'string' && !isSafeUrl(obj.contentButtonUrl)) {
      next.contentButtonUrl = ''
    }
    return next
  }) as unknown as T
}
