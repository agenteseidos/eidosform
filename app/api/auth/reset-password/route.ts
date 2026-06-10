import { createClient } from '@/lib/supabase/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { NextRequest, NextResponse } from 'next/server'
import { verifyRecoveryToken, RECOVERY_COOKIE_NAME } from '@/lib/recovery-token'

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json()

    if (!password || password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // P1-5: só permitir troca de senha SEM a senha antiga quando a sessão veio
    // mesmo do fluxo de recovery (cookie assinado posto pelo /auth/callback).
    // Uma sessão de login normal não tem esse cookie — para trocar a senha
    // logada, o caminho é /api/auth/change-password (que exige a senha atual).
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Sessão inválida ou expirada.' }, { status: 401 })
    }

    // Rate limit por usuário (5/15min) — endpoint troca senha sem a antiga.
    const { allowed } = await checkRateLimitAsync(`reset-password:${user.id}`, {
      maxAttempts: 5,
      windowMs: 15 * 60 * 1000,
    })
    if (!allowed) {
      return NextResponse.json({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, { status: 429 })
    }

    const recoveryCookie = req.cookies.get(RECOVERY_COOKIE_NAME)?.value
    if (!verifyRecoveryToken(recoveryCookie, user.id)) {
      return NextResponse.json(
        { error: 'Link de redefinição inválido ou expirado. Solicite um novo e-mail de redefinição.' },
        { status: 403 }
      )
    }

    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      const msg = (error.message || '').toLowerCase()
      let userMessage = 'Falha ao redefinir senha. Tente novamente.'
      if (msg.includes('same') || msg.includes('different from the old')) {
        userMessage = 'A nova senha deve ser diferente da senha atual.'
      }
      return NextResponse.json({ error: userMessage }, { status: 400 })
    }

    // Sign out after successful password reset
    await supabase.auth.signOut()

    // Consome o cookie de recovery (uso único).
    const res = NextResponse.json({ success: true }, { status: 200 })
    res.cookies.set(RECOVERY_COOKIE_NAME, '', { path: '/', maxAge: 0 })
    return res
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
