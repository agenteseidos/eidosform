import { createPublicClient } from '@/lib/supabase/public'
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
    // P0-1: Use signUp directly — it already returns a clear error for duplicate emails.
    // Previously used admin.listUsers() which was O(n), leaked all user metadata, and could OOM.
    const supabase = createPublicClient()
    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
      },
    })

    if (error) {
      // P0-1: Map common Supabase auth errors to user-friendly messages
      const msg = error.message ?? 'Signup failed'
      let userMessage = 'Erro ao criar conta. Tente novamente.'
      if (msg.includes('already registered') || msg.includes('already been registered')) {
        userMessage = 'Este e-mail já está cadastrado. Faça login.'
      } else if (msg.includes('Email not confirmed')) {
        userMessage = 'Este e-mail já foi cadastrado, mas ainda não foi confirmado.'
      }
      return NextResponse.json(
        { error: userMessage, code: msg.includes('already') ? 'EMAIL_ALREADY_REGISTERED' : 'SIGNUP_ERROR' },
        { status: 400 }
      )
    }

    // If Supabase returns a session, email autoconfirm is ON — user is already authenticated
    const autoConfirmed = !!data.session
    return NextResponse.json(
      {
        success: true,
        user: data.user,
        autoConfirmed,
        message: autoConfirmed
          ? 'Signup successful. Welcome!'
          : 'Signup successful. Please verify your email.',
      },
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
