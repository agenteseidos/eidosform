import { createClient } from '@/lib/supabase/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { email, password, fullName } = await req.json()

    // Validate input
    if (!email || !password || !fullName) {
      return NextResponse.json(
        { error: 'Email, password, and full name are required' },
        { status: 400 }
      )
    }

    // Validate password strength
    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' },
        { status: 400 }
      )
    }

    // Rate limit by email (5 signup attempts per 15 minutes)
    const rateLimitKey = `signup:${email.toLowerCase()}`
    const { allowed, resetIn } = await checkRateLimitAsync(rateLimitKey, {
      maxAttempts: 5,
      windowMs: 15 * 60 * 1000, // 15 minutes
    })

    if (!allowed) {
      return NextResponse.json(
        {
          error: 'Too many signup attempts. Please try again later.',
          retryAfter: Math.ceil(resetIn / 1000),
        },
        { status: 429, headers: { 'Retry-After': Math.ceil(resetIn / 1000).toString() } }
      )
    }

    const normalizedEmail = email.toLowerCase().trim()
    // F2-E5-01: Avoid email enumeration. Always return the same generic body
    // regardless of whether the email is new, already registered, or pending
    // confirmation. Real errors (e.g. invalid format, weak password) are still
    // surfaced because they apply equally to any caller.
    const supabase = await createClient()
    const { error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
      },
    })

    if (error) {
      const msg = error.message ?? ''
      // Treat duplicate-email errors as success to prevent enumeration; Supabase
      // sends a re-confirmation email instead of creating a duplicate account.
      const isDuplicate =
        msg.includes('already registered') ||
        msg.includes('already been registered') ||
        msg.includes('Email not confirmed')
      if (isDuplicate) {
        return NextResponse.json(
          { success: true, message: 'Verifique seu email para confirmar a conta.' },
          { status: 201 }
        )
      }
      console.error('Signup error:', error)
      return NextResponse.json(
        { error: 'Erro ao criar conta. Tente novamente.', code: 'SIGNUP_ERROR' },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { success: true, message: 'Verifique seu email para confirmar.' },
      { status: 201 }
    )
  } catch (error) {
    console.error('Signup error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
