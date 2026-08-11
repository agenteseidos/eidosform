import { createClient } from '@/lib/supabase/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/form-response-security'
import { NextRequest, NextResponse } from 'next/server'
import { safeLocalRedirect } from '@/lib/safe-redirect'
import { createHmac } from 'crypto'

export async function POST(req: NextRequest) {
  try {
    const { email, next } = await req.json()

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      )
    }

    // Rate limit em DUAS dimensões: e-mail HASHEADO e IP (auditoria 2026-08, lote 2-bis · D8).
    //
    // A chave era `resend:${email.toLowerCase()}` — só o e-mail, em claro. Consequências reais:
    // dava para gastar de fora os 3 reenvios de quem acabou de se cadastrar, deixando a pessoa
    // sem o e-mail de confirmação (conta nova que nunca abre); e quem quisesse despejar e-mail
    // em cima de uma lista inteira não achava teto, porque cada endereço trazia orçamento novo —
    // com custo de envio e reputação de domínio no nosso lado. O e-mail ainda era gravado
    // legível como chave persistida na tabela de rate limit (a PII que o D11 tirou da irmã).
    //
    // HMAC e não hash puro, pelo motivo escrito no D11: o espaço de busca é pequeno e é a chave
    // secreta que torna a reversão inviável. O teto por IP é ADICIONAL — os 3/15min por e-mail
    // continuam iguais para quem só quer o próprio e-mail de confirmação de novo.
    const normalizedEmail = String(email).toLowerCase().trim()
    const emailKeyHash = createHmac('sha256', process.env.INTERNAL_API_SECRET ?? 'fallback')
      .update(`email:${normalizedEmail}`)
      .digest('hex')
      .slice(0, 32)
    const ip = getClientIp(req)
    const [byEmail, byIp] = await Promise.all([
      checkRateLimitAsync(`resend:${emailKeyHash}`, { maxAttempts: 3, windowMs: 15 * 60 * 1000 }),
      checkRateLimitAsync(`resend:ip:${ip}`, { maxAttempts: 10, windowMs: 15 * 60 * 1000 }),
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
