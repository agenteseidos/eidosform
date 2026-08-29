/**
 * GET /auth/confirm — confirmação por TOKEN_HASH (H5, parecer Codex do achado #1
 * do teste 05/08). O fluxo PKCE do /auth/callback depende de uma meia-chave no
 * NAVEGADOR onde a pessoa se cadastrou — quem confirma em OUTRO aparelho
 * (cadastrou no desktop, abriu o e-mail no celular: o caso comum) confirmava o
 * e-mail mas perdia sessão, WhatsApp de boas-vindas e destino. O token_hash é
 * verificado NO SERVIDOR (verifyOtp) e independe do aparelho.
 *
 * Requer o template de e-mail do Supabase apontando pra cá:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next={{ .RedirectTo }}
 * O /auth/callback CONTINUA existindo (OAuth Google e links antigos em trânsito).
 */
import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { concederTrialNaConfirmacao } from '@/lib/trial/grant-on-confirm'
import { signRecoveryToken, RECOVERY_COOKIE_NAME } from '@/lib/recovery-token'
import { safeLocalRedirect } from '@/lib/safe-redirect'
import { notifyCadastroConfirmado } from '@/lib/whatsapp-confirmations'
import { logError } from '@/lib/logger'

const TYPES = new Set(['signup', 'email', 'magiclink', 'recovery', 'invite', 'email_change'] as const)
type OtpType = 'signup' | 'email' | 'magiclink' | 'recovery' | 'invite' | 'email_change'

/**
 * `next` pode chegar como URL COMPLETA (o {{ .RedirectTo }} do template devolve o
 * emailRedirectTo antigo, ex. https://.../auth/callback?type=signup&next=%2Fcheckout).
 * Extrai o destino local de dentro dela; qualquer outra coisa cai no safeLocalRedirect.
 */
function resolveNext(raw: string | null): string {
  if (raw && /^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw)
      const inner = u.searchParams.get('next')
      if (inner) return safeLocalRedirect(inner)
      if (u.pathname && u.pathname !== '/auth/callback' && u.pathname !== '/auth/confirm') {
        return safeLocalRedirect(u.pathname + u.search)
      }
      return '/forms'
    } catch { return '/forms' }
  }
  return safeLocalRedirect(raw)
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const typeRaw = String(searchParams.get('type') ?? '')
  const next = resolveNext(searchParams.get('next'))

  if (!tokenHash || !TYPES.has(typeRaw as OtpType)) {
    return NextResponse.redirect(`${origin}/login?error=confirm_invalid`)
  }
  const type = typeRaw as OtpType

  const supabase = await createClient()
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
  if (error) {
    // Token usado/expirado: quem já confirmou consegue logar normalmente.
    return NextResponse.redirect(`${origin}/login?error=confirm_expired`)
  }

  // Recovery espelha o callback: cookie assinado que autoriza trocar a senha.
  if (type === 'recovery') {
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

  // Gatilho do WhatsApp de cadastro — MESMA lógica/dedupe do callback: flag só
  // após envio ok; roda em after() (nunca atrasa o redirect).
  const user = data.user

  // TRIAL: conceder ANTES de decidir a mensagem. Duas razões para ser aqui e com await:
  //   (1) quem veio de uma campanha precisa achar o plano já ativo ao cair no painel;
  //   (2) a decisão sobre a mensagem depende do resultado — quem entrou por trial recebe o
  //       aviso do D0 ("seu acesso ao plano Plus foi ativado até DD/MM"), não o genérico
  //       "cadastro confirmado". Mandar os dois seria duas mensagens seguidas dizendo o mesmo.
  // Nunca lança: falha no trial não pode impedir alguém de confirmar o e-mail.
  const trial = type === 'signup' && user?.id
    ? await concederTrialNaConfirmacao(user.id, user.user_metadata)
    : { ehTrial: false }

  if (type === 'signup' && user?.id && !trial.ehTrial && user.user_metadata?.wpp_cadastro_notified !== true) {
    const userId = user.id
    const metadata = user.user_metadata ?? {}
    after(async () => {
      try {
        const result = await notifyCadastroConfirmado(userId)
        if (result.sent) {
          const { error: markErr } = await createAdminClient().auth.admin.updateUserById(userId, {
            user_metadata: { ...metadata, wpp_cadastro_notified: true },
          })
          if (markErr) logError('[auth-confirm] Falha ao marcar wpp_cadastro_notified', markErr, { userId })
        }
      } catch (err) {
        logError('[auth-confirm] Confirmação de cadastro por WhatsApp falhou (não bloqueante)', err, { userId })
      }
    })
  }

  return NextResponse.redirect(`${origin}${next}`)
}
