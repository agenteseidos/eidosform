import { createClient } from '@/lib/supabase/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { isValidWhatsAppPhone, toWhatsAppDigits } from '@/lib/phone'
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'

export async function POST(req: NextRequest) {
  try {
    const { email, password, fullName, phone } = await req.json()

    // Validate input
    if (
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      typeof fullName !== 'string' ||
      typeof phone !== 'string' ||
      !email || !password || !fullName || !phone
    ) {
      return NextResponse.json(
        { error: 'Email, password, full name, and phone are required' },
        { status: 400 }
      )
    }

    // Telefone: MESMA regra do resto da stack (lib/phone.ts, 10..15 dígitos).
    if (!isValidWhatsAppPhone(phone)) {
      return NextResponse.json(
        { error: 'Telefone inválido. Inclua o DDD.' },
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

    const normalizedEmail = email.toLowerCase().trim()
    const emailHash = createHash('sha256').update(normalizedEmail).digest('hex').slice(0, 24)
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    // Três tetos: e-mail normalizado, IP e global. Espaços no e-mail e spray de
    // endereços diferentes não criam mais orçamento ilimitado.
    const [byEmail, byIp, global] = await Promise.all([
      checkRateLimitAsync(`signup:email:${emailHash}`, { maxAttempts: 5, windowMs: 15 * 60 * 1000 }),
      checkRateLimitAsync(`signup:ip:${ip}`, { maxAttempts: 20, windowMs: 15 * 60 * 1000 }),
      checkRateLimitAsync('signup:global', { maxAttempts: 300, windowMs: 15 * 60 * 1000 }),
    ])
    const denied = [byEmail, byIp, global].find((result) => !result.allowed)

    if (denied) {
      return NextResponse.json(
        {
          error: 'Too many signup attempts. Please try again later.',
          retryAfter: Math.ceil(denied.resetIn / 1000),
        },
        { status: 429, headers: { 'Retry-After': Math.ceil(denied.resetIn / 1000).toString() } }
      )
    }

    // Guardamos SEMPRE em dígitos com DDI (ex.: "5583999376704"). O 55 é
    // explícito para 10/11 dígitos porque nesse comprimento o número é
    // brasileiro sem DDI — a mesma regra do envio/wa.me (lib/phone.ts, P2-3).
    // A partir daqui `profiles.phone_match_key_br` (coluna GERADA) é derivada
    // automaticamente e liga a conta à identidade de follow-up.
    const normalizedPhone = toWhatsAppDigits(phone)
    // F2-E5-01: Avoid email enumeration. Always return the same generic body
    // regardless of whether the email is new, already registered, or pending
    // confirmation. Real errors (e.g. invalid format, weak password) are still
    // surfaced because they apply equally to any caller.
    const supabase = await createClient()
    const { error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: { full_name: fullName, phone: normalizedPhone },
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
