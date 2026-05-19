import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { signRecoveryToken, RECOVERY_COOKIE_NAME } from '@/lib/recovery-token'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const rawNext = searchParams.get('next') ?? '/forms'
  // Prevent open redirect: only allow relative paths starting with /
  const next = (rawNext.startsWith('/') && !rawNext.startsWith('//')) ? rawNext : '/forms'
  const type = searchParams.get('type')

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Password reset flow — redirect to reset-password page e marca a sessão
      // como "de recovery" via cookie httpOnly assinado, para que o endpoint
      // de reset aceite trocar a senha sem a senha antiga (P1-5).
      if (next === '/reset-password' || type === 'recovery') {
        const res = NextResponse.redirect(`${origin}/reset-password`)
        if (data.user?.id) {
          res.cookies.set(RECOVERY_COOKIE_NAME, signRecoveryToken(data.user.id), {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 15 * 60,
          })
        }
        return res
      }

      // Email confirmation or OAuth — redirect to dashboard (or next)
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`)
}
