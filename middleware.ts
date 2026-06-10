import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { logWarn } from '@/lib/logger'

// P1-13: Allowed origins for write operations (CSRF protection)
const ALLOWED_ORIGINS = process.env.NEXT_PUBLIC_APP_URL
  ? [process.env.NEXT_PUBLIC_APP_URL]
  : []

// Custom domain cache: domain → { slug, expiresAt }
// Limited to 1000 entries to prevent unbounded memory growth (S1-P2-26)
const customDomainCache = new Map<string, { slug: string; expiresAt: number }>()
const CACHE_TTL_MS = 60_000 // 1 minute
const CACHE_MAX_SIZE = 1000

const APP_HOSTNAME = process.env.NEXT_PUBLIC_APP_URL
  ? new URL(process.env.NEXT_PUBLIC_APP_URL).hostname
  : null

function isWriteRequest(request: NextRequest): boolean {
  const method = request.method
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE'
}

// A2 (auditoria 2026-06-10): CSP estrita com nonce + strict-dynamic para o
// player público /f/:slug. Browsers modernos passam a exigir nonce em scripts
// inline (qualquer regressão de sanitização deixa de ser XSS executável);
// browsers antigos (sem suporte a nonce) caem no comportamento anterior via
// 'unsafe-inline' + allowlist de hosts, que o CSP3 ignora quando há nonce.
// Os <Script> de pixels recebem o nonce via header x-nonce (lido na page).
const PIXEL_SCRIPT_HOSTS =
  'https://*.googletagmanager.com https://www.google-analytics.com https://ssl.google-analytics.com https://www.facebook.com https://connect.facebook.net https://snap.licdn.com https://www.googleadservices.com https://www.google.com https://analytics.tiktok.com https://*.doubleclick.net https://assets.calendly.com'

function buildFormPlayerCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline' 'self' ${PIXEL_SCRIPT_HOSTS}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.asaas.com https://www.facebook.com https://connect.facebook.net https://*.facebook.net https://*.facebook.com https://analytics.tiktok.com https://*.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.google.com https://*.googleadservices.com https://www.google.com/pagead https://*.doubleclick.net https://viacep.com.br https://calendly.com https://*.calendly.com",
    "frame-src 'self' https:",
    "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com https://assets.calendly.com",
    'frame-ancestors *',
    "form-action 'self'",
    "base-uri 'self'",
  ].join('; ')
}

/** Resposta com nonce por request para páginas do player público. */
function formPlayerResponse(request: NextRequest, rewriteUrl?: URL): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const csp = buildFormPlayerCsp(nonce)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  // O Next lê o nonce do header CSP do request para aplicá-lo aos próprios
  // scripts inline do framework (hidratação/RSC payload).
  requestHeaders.set('Content-Security-Policy', csp)
  const response = rewriteUrl
    ? NextResponse.rewrite(rewriteUrl, { request: { headers: requestHeaders } })
    : NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)
  return response
}

/**
 * Resolve a custom domain to a form slug.
 * Uses in-memory cache with TTL to avoid hitting DB on every request.
 */
async function resolveCustomDomain(hostname: string): Promise<string | null> {
  const cached = customDomainCache.get(hostname)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.slug
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) return null

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/custom_domains?domain=eq.${encodeURIComponent(hostname)}&verified=eq.true&select=form_id`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
    })
    if (!res.ok) return null
    const rows = await res.json()
    if (!rows || rows.length === 0 || !rows[0].form_id) return null

    // Fetch the form's slug
    const formRes = await fetch(`${supabaseUrl}/rest/v1/forms?id=eq.${rows[0].form_id}&select=slug,status`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
    })
    if (!formRes.ok) return null
    const forms = await formRes.json()
    if (!forms || forms.length === 0) return null

    // Only route to published forms
    const form = forms[0]
    if (form.status !== 'published') return null

    // Evict oldest entry if cache is full
    if (customDomainCache.size >= CACHE_MAX_SIZE) {
      const firstKey = customDomainCache.keys().next().value
      if (firstKey) customDomainCache.delete(firstKey)
    }
    customDomainCache.set(hostname, {
      slug: form.slug,
      expiresAt: Date.now() + CACHE_TTL_MS,
    })
    return form.slug
  } catch {
    return null
  }
}

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get('host')?.split(':')[0] || '' // strip port

  // Track if this is a verified custom domain (for CSRF bypass below)
  let isVerifiedCustomDomain = false

  // Custom domain routing: if hostname is not the app's own domain,
  // resolve it to a form and rewrite to /f/[slug]
  if (hostname && APP_HOSTNAME && hostname !== APP_HOSTNAME) {
    const slug = await resolveCustomDomain(hostname)

    if (!slug) {
      // Domain not found — redirect to main app
      const appUrl = new URL(request.nextUrl.pathname, process.env.NEXT_PUBLIC_APP_URL || 'https://eidosform.com.br')
      return NextResponse.redirect(appUrl, 302)
    }

    isVerifiedCustomDomain = true

    // Skip rewrite for API routes and Next.js internal paths.
    // API routes use form IDs in body/URL (not slug routing),
    // and _next/* paths must pass through unchanged for client-side navigation.
    const isInternalPath =
      request.nextUrl.pathname.startsWith('/api/') ||
      request.nextUrl.pathname.startsWith('/_next/')

    if (!isInternalPath) {
      // Preserve the path — if someone accesses forms.cliente.com.br/some/path,
      // rewrite to eidosform.com.br/f/slug/some/path
      const originalPath = request.nextUrl.pathname
      const rewritePath = originalPath === '/' ? `/f/${slug}` : `/f/${slug}${originalPath}`
      const url = request.nextUrl.clone()
      url.pathname = rewritePath
      // Conteúdo servido é o player público — aplica a CSP com nonce (A2).
      return formPlayerResponse(request, url)
    }
    // API / _next paths fall through to normal middleware (session + CSRF)
  }

  // Player público /f/:slug — só CSP com nonce; sem sessão/CSRF (rota pública).
  if (request.nextUrl.pathname.startsWith('/f/')) {
    return formPlayerResponse(request)
  }

  const response = await updateSession(request)

  // P1-13: CSRF protection — verify Origin header on write requests to /api/*
  if (isWriteRequest(request) && request.nextUrl.pathname.startsWith('/api/')) {
    // F2-E5-02: Only /api/responses is intentionally CORS-open (forms embed
    // anywhere). /api/auth/* must enforce CSRF since it sets the session cookie.
    const publicWritePaths = ['/api/responses']
    const isPublic = publicWritePaths.some(p => request.nextUrl.pathname.startsWith(p)) || isVerifiedCustomDomain

    if (!isPublic) {
      const origin = request.headers.get('origin')
      const referer = request.headers.get('referer')
      if (ALLOWED_ORIGINS.length === 0 && process.env.NODE_ENV === 'production') {
        logWarn('CSRF check disabled: NEXT_PUBLIC_APP_URL not set in production', { path: request.nextUrl.pathname })
      }
      const allowed = ALLOWED_ORIGINS.length > 0
        ? ALLOWED_ORIGINS.some(o => origin === o || (referer && referer.startsWith(o)))
        : true // No allowed origins configured — skip check in development

      if (!allowed && origin) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     * Nota: /f/ (player público) AGORA passa pelo middleware — apenas para
     * receber a CSP com nonce (A2); retorna antes de sessão/CSRF.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

