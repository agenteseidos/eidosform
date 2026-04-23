import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// P1-13: Allowed origins for write operations (CSRF protection)
const ALLOWED_ORIGINS = process.env.NEXT_PUBLIC_APP_URL
  ? [process.env.NEXT_PUBLIC_APP_URL]
  : []

function isWriteRequest(request: NextRequest): boolean {
  const method = request.method
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE'
}

export async function middleware(request: NextRequest) {
  const response = await updateSession(request)

  // P1-13: CSRF protection — verify Origin header on write requests to /api/*
  if (isWriteRequest(request) && request.nextUrl.pathname.startsWith('/api/')) {
    // Skip public endpoints that are meant to be called from any domain
    const publicWritePaths = ['/api/responses', '/api/auth/']
    const isPublic = publicWritePaths.some(p => request.nextUrl.pathname.startsWith(p))

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

