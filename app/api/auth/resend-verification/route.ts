import { createClient } from '@/lib/supabase/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { NextRequest, NextResponse } from 'next/server'
import { safeLocalRedirect } from '@/lib/safe-redirect'

export async function POST(req: NextRequest) {
  try {
    const { email, next } = await req.json()

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      )
    }

    // Rate limit: 3 resends per 15 minutes
    const rateLimitKey = `resend:${email.toLowerCase()}`
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

    const supabase = await createClient()
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        // Recompõe o MESMO callback do signup (type=signup + next) — sem isto o
        // reenvio derrubava o gatilho do WhatsApp e o destino preservado.
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?type=signup${
          typeof next === 'string' && next ? `&next=${encodeURIComponent(safeLocalRedirect(next))}` : ''
        }`,
      },
    })

    if (error) {
      // Don't leak whether email exists
      console.error('Resend verification error:', error.message)
    }

    // Always return success to prevent email enumeration
    return NextResponse.json({ success: true }, { status: 200 })
  } catch {
    return NextResponse.json({ success: true }, { status: 200 })
  }
}
