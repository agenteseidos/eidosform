import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Simple in-memory rate limiter: max 5 magic link requests per IP per minute
const magicLinkStore = new Map<string, { count: number; windowStart: number }>()
const MAGIC_LINK_WINDOW_MS = 60 * 1000
const MAGIC_LINK_MAX = 5

function checkMagicLinkRateLimit(ip: string): { allowed: boolean; resetIn: number } {
  const now = Date.now()
  const entry = magicLinkStore.get(ip)

  if (!entry || now - entry.windowStart > MAGIC_LINK_WINDOW_MS) {
    magicLinkStore.set(ip, { count: 1, windowStart: now })
    return { allowed: true, resetIn: MAGIC_LINK_WINDOW_MS }
  }

  if (entry.count >= MAGIC_LINK_MAX) {
    const resetIn = MAGIC_LINK_WINDOW_MS - (now - entry.windowStart)
    return { allowed: false, resetIn }
  }

  entry.count++
  return { allowed: true, resetIn: MAGIC_LINK_WINDOW_MS - (now - entry.windowStart) }
}

// POST /api/auth/magic-link — send magic link email (rate limited by IP)
export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    '127.0.0.1'

  const { allowed, resetIn } = checkMagicLinkRateLimit(ip)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait before requesting another magic link.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(resetIn / 1000)) },
      }
    )
  }

  const body = await req.json().catch(() => ({}))
  const { email } = body as { email?: string }

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )

  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/auth/callback`

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  })

  if (error) {
    console.error('Magic link error:', error.message)
    return NextResponse.json({ error: 'Failed to send magic link' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
