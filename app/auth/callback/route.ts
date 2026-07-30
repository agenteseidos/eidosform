import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { signRecoveryToken, RECOVERY_COOKIE_NAME } from '@/lib/recovery-token'
import { safeLocalRedirect } from '@/lib/safe-redirect'
import { notifyCadastroConfirmado } from '@/lib/whatsapp-confirmations'
import { logError } from '@/lib/logger'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = safeLocalRedirect(searchParams.get('next'))
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

      // Confirmação de cadastro (type=signup): confirma por WhatsApp UMA vez,
      // com dedupe por flag em user_metadata. A flag só é gravada APÓS envio
      // bem-sucedido — template ainda PENDING na Meta ou falha transitória não
      // queimam a única chance (o próximo clique no link tenta de novo; numa
      // corrida de duplo-clique pode duplicar — aceitável p/ transacional).
      // Roda em after(): nunca atrasa nem quebra o redirect do usuário.
      const user = data.user
      if (type === 'signup' && user?.id && user.user_metadata?.wpp_cadastro_notified !== true) {
        const userId = user.id
        const metadata = user.user_metadata ?? {}
        after(async () => {
          try {
            const result = await notifyCadastroConfirmado(userId)
            if (result.sent) {
              const { error: markErr } = await createAdminClient().auth.admin.updateUserById(userId, {
                user_metadata: { ...metadata, wpp_cadastro_notified: true },
              })
              if (markErr) logError('[auth-callback] Falha ao marcar wpp_cadastro_notified', markErr, { userId })
            }
          } catch (err) {
            logError('[auth-callback] Confirmação de cadastro por WhatsApp falhou (não bloqueante)', err, { userId })
          }
        })
      }

      // Email confirmation or OAuth — redirect to dashboard (or next)
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`)
}
