import { isSafeUrl, ALLOWED_TAGS, ALLOWED_ATTR } from './html'

/**
 * Server-only HTML sanitization — NO jsdom dependency.
 * Uses a lightweight tag-stripping + attribute-filtering approach
 * that works in Vercel serverless functions.
 *
 * As funções são JS puro (só regex) e também podem rodar no client
 * como defesa em profundidade.
 */

const ALLOWED_TAGS_SET = new Set(ALLOWED_TAGS)
const ALLOWED_ATTR_SET = new Set(ALLOWED_ATTR)

/**
 * Hosts permitidos como origem (`src`) de um `<iframe>` em html_block.
 * Cobre os embeds documentados (Calendly, YouTube, Google Maps/Calendar, etc.).
 * Match por host exato OU subdomínio (`host === h || host.endsWith('.' + h)`).
 */
const ALLOWED_IFRAME_HOSTS = [
  'calendly.com',
  'youtube.com',
  'youtube-nocookie.com',
  'youtu.be',
  'google.com',
  'vimeo.com',
  'spotify.com',
  'loom.com',
  'figma.com',
  'typeform.com',
]

/** Atributos seguros mantidos num `<iframe>` sanitizado. */
const SAFE_IFRAME_ATTRS = new Set([
  'src', 'width', 'height', 'frameborder', 'allow', 'allowfullscreen',
  'loading', 'referrerpolicy', 'title', 'style', 'name', 'scrolling',
])

/** true se `src` é https e o host está na allowlist de iframes. */
function isAllowedIframeSrc(src: string): boolean {
  try {
    const u = new URL(src)
    if (u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase()
    return ALLOWED_IFRAME_HOSTS.some((h) => host === h || host.endsWith('.' + h))
  } catch {
    return false
  }
}

/**
 * Reconstrói uma tag `<iframe>` mantendo só atributos seguros.
 * Retorna '' (remove o iframe) se o `src` não estiver na allowlist de hosts.
 */
function sanitizeIframeTag(match: string): string {
  const srcMatch = match.match(/\bsrc\s*=\s*"([^"]*)"/i) || match.match(/\bsrc\s*=\s*'([^']*)'/i)
  const src = srcMatch ? srcMatch[1].trim() : ''
  if (!isAllowedIframeSrc(src)) return ''

  const attrRegex = /\s+([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*("[^"]*"|'[^']*')/g
  let attrs = ''
  let attrMatch: RegExpExecArray | null
  while ((attrMatch = attrRegex.exec(match)) !== null) {
    const name = attrMatch[1].toLowerCase()
    // Nunca manter handlers de evento (onload, onerror, ...) nem srcdoc.
    if (name.startsWith('on') || name === 'srcdoc') continue
    if (!SAFE_IFRAME_ATTRS.has(name)) continue
    attrs += ` ${name}=${attrMatch[2]}`
  }
  return `<iframe${attrs}>`
}

/**
 * Strip all HTML tags except allowed ones, and remove all attributes
 * except allowed ones. Sanitizes href values with isSafeUrl.
 *
 * Com `opts.allowIframe`, mantém `<iframe>` cujo `src` esteja na allowlist
 * de hosts (usado pelo html_block); todo o resto continua sendo removido.
 */
export function sanitizeHtmlServer(dirty: unknown, opts?: { allowIframe?: boolean }): string {
  if (typeof dirty !== 'string' || !dirty) return ''

  let input = dirty
  if (opts?.allowIframe) {
    // Remove blocos perigosos inteiros (conteúdo + tags) antes de processar.
    input = input
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
  }

  // Replace all tags — keep allowed, strip others
  return input.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g, (match, tagName) => {
    const tag = tagName.toLowerCase()

    // iframe é tratado à parte e só quando explicitamente permitido.
    if (tag === 'iframe') {
      if (!opts?.allowIframe) return ''
      if (match.startsWith('</')) return '</iframe>'
      return sanitizeIframeTag(match)
    }

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

      filteredAttrs += ' ' + attrValue
    }

    return `<${tag}${filteredAttrs}>`
  })
}

/**
 * Sanitiza HTML de embed (html_block): tags de formatação + `<iframe>`
 * de hosts confiáveis. Remove `<script>`, handlers `on*`, `srcdoc` e
 * iframes de hosts fora da allowlist.
 */
export function sanitizeEmbedHtml(dirty: unknown): string {
  return sanitizeHtmlServer(dirty, { allowIframe: true })
}

export function sanitizeContentBlocksServer<T>(questions: T): T {
  if (!Array.isArray(questions)) return questions
  return questions.map((q) => {
    if (!q || typeof q !== 'object') return q
    const obj = q as Record<string, unknown>

    if (obj.type === 'content_block') {
      const next: Record<string, unknown> = { ...obj }
      if (typeof obj.contentBody === 'string') {
        next.contentBody = sanitizeHtmlServer(obj.contentBody)
      }
      if (typeof obj.contentButtonUrl === 'string' && !isSafeUrl(obj.contentButtonUrl)) {
        next.contentButtonUrl = ''
      }
      return next
    }

    // html_block: o HTML livre do dono (htmlContent) é sanitizado com a
    // allowlist de iframes. A nota (htmlBlockNote) NÃO é tocada aqui — ela é
    // rich-text estruturado do editor Tiptap, sanitizado no render.
    if (obj.type === 'html_block') {
      if (typeof obj.htmlContent !== 'string') return q
      return { ...obj, htmlContent: sanitizeEmbedHtml(obj.htmlContent) }
    }

    return q
  }) as unknown as T
}
