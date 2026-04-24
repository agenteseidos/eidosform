import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// P1-13: Allowed origins for write operations (CSRF protection)
const ALLOWED_ORIGINS = process.env.NEXT_PUBLIC_APP_URL
  ? [process.env.NEXT_PUBLIC_APP_URL]
  : []

// Custom domain cache: domain → { slug, expiresAt }
const customDomainCache = new Map<string, { slug: string; expiresAt: number }>()
const CACHE_TTL_MS = 60_000 // 1 minute

const APP_HOSTNAME = process.env.NEXT_PUBLIC_APP_URL
  ? new URL(process.env.NEXT_PUBLIC_APP_URL).hostname
  : null

function isWriteRequest(request: NextRequest): boolean {
  const method = request.method
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE'
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
      return NextResponse.rewrite(url)
    }
    // API / _next paths fall through to normal middleware (session + CSRF)
  }

  const response = await updateSession(request)

  // P1-13: CSRF protection — verify Origin header on write requests to /api/*
  if (isWriteRequest(request) && request.nextUrl.pathname.startsWith('/api/')) {
    // Skip public endpoints that are meant to be called from any domain,
    // plus verified custom domains (auth cookies are domain-scoped, so CSRF risk is nil)
    const publicWritePaths = ['/api/responses', '/api/auth/']
    const isPublic = publicWritePaths.some(p => request.nextUrl.pathname.startsWith(p)) || isVerifiedCustomDomain

    if (!isPublic) {
      const origin = request.headers.get('origin')
      const referer = request.headers.get('referer')
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
     * - f/ (public form pages)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$|f/).*)',
  ],
}

