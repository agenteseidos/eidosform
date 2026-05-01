import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

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
