import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const rawNext = searchParams.get('next') ?? '/billing'
  // Prevent open redirect: only allow relative paths starting with /
  const next = (rawNext.startsWith('/') && !rawNext.startsWith('//')) ? rawNext : '/billing'
  const type = searchParams.get('type')

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Password reset flow — redirect to reset-password page
      if (next === '/reset-password' || type === 'recovery') {
        return NextResponse.redirect(`${origin}/reset-password`)
      }

      // Email confirmation or OAuth — redirect to dashboard (or next)
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`)
}
