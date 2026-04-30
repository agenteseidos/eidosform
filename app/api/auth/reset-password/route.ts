import { createClient } from '@/lib/supabase/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { NextRequest, NextResponse } from 'next/server'

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

    return NextResponse.json({ success: true }, { status: 200 })
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
