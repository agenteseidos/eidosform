import { createClient } from '@/lib/supabase/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json()

    // Validate input
    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      )
    }

    // Rate limit by email (5 attempts per 15 minutes)
    const rateLimitKey = `login:${email.toLowerCase()}`
    const { allowed, resetIn } = await checkRateLimitAsync(rateLimitKey, {
      maxAttempts: 5,
      windowMs: 15 * 60 * 1000, // 15 minutes
    })

    if (!allowed) {
      return NextResponse.json(
        {
          error: 'Too many login attempts. Please try again later.',
          retryAfter: Math.ceil(resetIn / 1000),
        },
        { status: 429, headers: { 'Retry-After': Math.ceil(resetIn / 1000).toString() } }
      )
    }

    // Create Supabase client and attempt login
    const supabase = await createClient()
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      // P1 / F2-E2-01: Return generic error to avoid leaking auth details
      return NextResponse.json(
        { error: 'E-mail ou senha incorretos' },
        { status: 401 }
      )
    }

    // P0-3 / F2-E2-01: Block sign-in for unconfirmed emails so the session is
    // never established before the email is verified.
    if (!data.user?.email_confirmed_at) {
      // Drop the partial session that signInWithPassword may have created.
      await supabase.auth.signOut().catch(() => {})
      return NextResponse.json(
        { error: 'Confirme seu email antes de entrar.', code: 'EMAIL_NOT_CONFIRMED' },
        { status: 403 }
      )
    }

    // Slim response: do not leak the full user object.
    return NextResponse.json(
      {
        success: true,
        redirectTo: '/forms',
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
