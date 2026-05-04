import { isSafeUrl, ALLOWED_TAGS, ALLOWED_ATTR } from './html'

/**
 * Server-only HTML sanitization — NO jsdom dependency.
 * Uses a lightweight tag-stripping + attribute-filtering approach
 * that works in Vercel serverless functions.
 */

const ALLOWED_TAGS_SET = new Set(ALLOWED_TAGS)
const ALLOWED_ATTR_SET = new Set(ALLOWED_ATTR)

/**
 * Strip all HTML tags except allowed ones, and remove all attributes
 * except allowed ones. Sanitizes href values with isSafeUrl.
 */
export function sanitizeHtmlServer(dirty: unknown): string {
  if (typeof dirty !== 'string' || !dirty) return ''
  
  // Replace all tags — keep allowed, strip others
  return dirty.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g, (match, tagName) => {
    const tag = tagName.toLowerCase()
    
    // Closing tag for allowed element
    if (match.startsWith('</')) {
      return ALLOWED_TAGS_SET.has(tag) ? `</${tag}>` : ''
    }
    
    // Not allowed — strip entirely
    if (!ALLOWED_TAGS_SET.has(tag)) return ''
    
    // Allowed tag — filter attributes
    const attrRegex = /\s+([a-zA-Z][a-zA-Z0-9-]*)=(?:"[^"]*"|'[^']*')/g
    let filteredAttrs = ''
    let attrMatch
    while ((attrMatch = attrRegex.exec(match)) !== null) {
      const attrName = attrMatch[1].toLowerCase()
      if (!ALLOWED_ATTR_SET.has(attrName)) continue
      
      let attrValue = attrMatch[0].trim()
      
      // Sanitize href
      if (attrName === 'href') {
        const hrefMatch = attrValue.match(/="([^"]*)"/)
        if (hrefMatch && !isSafeUrl(hrefMatch[1])) {
          attrValue = ' href="#"'
        }
      }
      
      filteredAttrs += attrValue
    }
    
    return `<${tag}${filteredAttrs}>`
  })
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
