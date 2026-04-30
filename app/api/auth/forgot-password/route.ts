import { createPublicClient } from '@/lib/supabase/public'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      )
    }

    // Rate limit: 3 attempts per 15 minutes
    const rateLimitKey = `forgot:${email.toLowerCase()}`
    const { allowed, resetIn } = await checkRateLimitAsync(rateLimitKey, {
      maxAttempts: 3,
      windowMs: 15 * 60 * 1000,
    })

    if (!allowed) {
      return NextResponse.json(
        {
          error: 'Too many requests. Please try again later.',
          retryAfter: Math.ceil(resetIn / 1000),
        },
        { status: 429, headers: { 'Retry-After': Math.ceil(resetIn / 1000).toString() } }
      )
    }

    const supabase = createPublicClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/reset-password`,
    })

    if (error) {
      // Always return success to prevent email enumeration
      console.error('Forgot password error:', error.message)
    }

    // Always return success regardless of whether email exists
    return NextResponse.json({ success: true }, { status: 200 })
  } catch {
    // Even on server error, return success to prevent enumeration
    return NextResponse.json({ success: true }, { status: 200 })
  }
}
