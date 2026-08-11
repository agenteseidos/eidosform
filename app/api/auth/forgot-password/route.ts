import { createClient } from '@/lib/supabase/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/form-response-security'
import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      )
    }

    // Rate limit em DUAS dimensões: e-mail HASHEADO e IP (auditoria 2026-08, lote 2-bis · D8).
    //
    // A chave era `forgot:${email.toLowerCase()}` — só o e-mail, em claro. Aqui o estrago é o
    // mais cruel da família: qualquer um, de fora, podia gastar as 3 tentativas do e-mail de
    // uma pessoa e ela ficava SEM CONSEGUIR PEDIR RECUPERAÇÃO DE SENHA — travada para fora da
    // própria conta sem ter feito nada. Do outro lado, disparar recuperação para uma lista
    // inteira de e-mails não encontrava teto nenhum: cada endereço trazia seu próprio orçamento,
    // e cada tentativa é um e-mail PAGO saindo. E o e-mail ainda ficava gravado legível como
    // chave persistida na tabela de rate limit (a PII que o D11 já tinha tirado da irmã).
    //
    // HMAC e não hash puro, pelo motivo escrito no D11: o espaço de busca é pequeno e é a chave
    // secreta que torna a reversão inviável. O teto por IP é ADICIONAL — os 3/15min por e-mail
    // continuam iguais para quem pede a própria recuperação.
    const normalizedEmail = String(email).toLowerCase().trim()
    const emailKeyHash = createHmac('sha256', process.env.INTERNAL_API_SECRET ?? 'fallback')
      .update(`email:${normalizedEmail}`)
      .digest('hex')
      .slice(0, 32)
    const ip = getClientIp(req)
    const [byEmail, byIp] = await Promise.all([
      checkRateLimitAsync(`forgot:${emailKeyHash}`, { maxAttempts: 3, windowMs: 15 * 60 * 1000 }),
      checkRateLimitAsync(`forgot:ip:${ip}`, { maxAttempts: 10, windowMs: 15 * 60 * 1000 }),
    ])
    const denied = [byEmail, byIp].find((r) => !r.allowed)

    if (denied) {
      return NextResponse.json(
        {
          error: 'Too many requests. Please try again later.',
          retryAfter: Math.ceil(denied.resetIn / 1000),
        },
        { status: 429, headers: { 'Retry-After': Math.ceil(denied.resetIn / 1000).toString() } }
      )
    }

    const supabase = await createClient()
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
