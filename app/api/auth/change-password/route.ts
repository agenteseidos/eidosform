import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  try {
    const { currentPassword, newPassword } = await req.json()

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: 'Todos os campos são obrigatórios' },
        { status: 400 }
      )
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: 'A nova senha deve ter no mínimo 8 caracteres' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    if (!user.email) {
      return NextResponse.json(
        { error: 'Conta sem e-mail não suporta alteração de senha' },
        { status: 400 }
      )
    }

    // Rate limit por usuário (auditoria 2026-08, lote 2-bis · D7).
    //
    // Esta era a ÚNICA rota de autenticação sem teto — e é justamente a que VERIFICA a senha
    // atual, logo abaixo, com um `signInWithPassword`. Todas as irmãs têm: login 5/15min,
    // forgot 3/15min, resend 3/15min, reset-password 5/15min, delete 3/15min.
    //
    // Sem teto, quem chega a uma sessão aberta (máquina destravada, cookie roubado) pode
    // adivinhar a senha atual à vontade, e cada tentativa é um `signInWithPassword` real contra
    // o Supabase Auth. Mesmo teto e mesma chave-por-usuário da `reset-password`, que é a irmã
    // mais próxima em risco.
    const { allowed } = await checkRateLimitAsync(`change-password:${user.id}`, {
      maxAttempts: 5,
      windowMs: 15 * 60 * 1000,
    })
    if (!allowed) {
      return NextResponse.json(
        { error: 'Muitas tentativas. Tente novamente mais tarde.' },
        { status: 429 }
      )
    }

    // Verify current password via re-authentication
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    })

    if (signInError) {
      return NextResponse.json({ error: 'Senha atual incorreta' }, { status: 400 })
    }

    // Update to new password
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })

    if (updateError) {
      const msg = (updateError.message || '').toLowerCase()
      if (msg.includes('same') || msg.includes('different')) {
        return NextResponse.json(
          { error: 'A nova senha deve ser diferente da senha atual' },
          { status: 400 }
        )
      }
      return NextResponse.json(
        { error: 'Falha ao alterar senha. Tente novamente.' },
        { status: 400 }
      )
    }

    // Revoke all sessions
    await supabase.auth.signOut({ scope: 'global' })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
