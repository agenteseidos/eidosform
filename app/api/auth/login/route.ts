import { createClient } from '@/lib/supabase/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/form-response-security'
import { NextRequest, NextResponse } from 'next/server'
import { safeLocalRedirect } from '@/lib/safe-redirect'
import { createHmac } from 'crypto'

export async function POST(req: NextRequest) {
  try {
    const { email, password, redirectTo } = await req.json()

    // Validate input
    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      )
    }

    // Rate limit em DUAS dimensões: e-mail HASHEADO e IP (auditoria 2026-08, lote 2-bis · D8).
    //
    // A chave era `login:${email.toLowerCase()}` — só o e-mail, em claro. Três estragos reais:
    //  · quem varria senhas em MUITAS contas nunca era barrado: cada e-mail tinha seu próprio
    //    orçamento de 5 tentativas, e bastava trocar o e-mail para zerar o contador;
    //  · dava para TRANCAR uma pessoa de fora — gastando as tentativas do e-mail dela, ela
    //    perdia o acesso sem nunca ter errado nada;
    //  · o e-mail ficava gravado LEGÍVEL como chave persistida na tabela de rate limit — a mesma
    //    PII fora do lugar que o D11 já tinha tirado da rota de migração.
    //
    // HMAC e não hash puro, pelo motivo escrito no D11: o espaço de busca é pequeno (listas de
    // e-mail vazado fazem o papel da tabela arco-íris), e é a chave secreta que torna a reversão
    // inviável. O teto por IP é ADICIONAL: o de 5/15min por conta continua igual, e quem tem o
    // e-mail e a senha certos entra na primeira tentativa como sempre.
    const normalizedEmail = String(email).toLowerCase().trim()
    const emailKeyHash = createHmac('sha256', process.env.INTERNAL_API_SECRET ?? 'fallback')
      .update(`email:${normalizedEmail}`)
      .digest('hex')
      .slice(0, 32)
    const ip = getClientIp(req)
    const [byEmail, byIp] = await Promise.all([
      checkRateLimitAsync(`login:${emailKeyHash}`, { maxAttempts: 5, windowMs: 15 * 60 * 1000 }),
      checkRateLimitAsync(`login:ip:${ip}`, { maxAttempts: 20, windowMs: 15 * 60 * 1000 }),
    ])
    const denied = [byEmail, byIp].find((r) => !r.allowed)

    if (denied) {
      return NextResponse.json(
        {
          error: 'Too many login attempts. Please try again later.',
          retryAfter: Math.ceil(denied.resetIn / 1000),
        },
        { status: 429, headers: { 'Retry-After': Math.ceil(denied.resetIn / 1000).toString() } }
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
        redirectTo: safeLocalRedirect(redirectTo),
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
