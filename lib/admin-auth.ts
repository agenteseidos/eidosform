import { NextRequest, NextResponse } from 'next/server'
import { User } from '@supabase/supabase-js'
import { getRequestUser } from '@/lib/supabase/request-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export function getAdminEmails(): string[] {
  const emails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)

  return Array.from(new Set(emails))
}

export function isAdminEmail(email?: string | null) {
  if (!email) return false
  return getAdminEmails().includes(email.trim().toLowerCase())
}

export async function requireAdmin(req: NextRequest): Promise<
  | { ok: true; user: User }
  | { ok: false; response: NextResponse }
> {
  const user = await getRequestUser(req)

  console.log('[AUTH] User email:', user?.email)
  console.log('[AUTH] User exists:', !!user)

  if (!user?.email) {
    console.log('[AUTH] No email in user')
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized', debug: 'no_email' }, { status: 401 }),
    }
  }

  const adminEmails = getAdminEmails()
  console.log('[AUTH] Admin emails:', adminEmails)
  console.log('[AUTH] Is admin?', adminEmails.includes(user.email.trim().toLowerCase()))

  if (!isAdminEmail(user.email)) {
    console.log('[AUTH] User NOT in admin list')
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden', debug: 'not_admin' }, { status: 403 }),
    }
  }

  console.log('[AUTH] ADMIN ACCESS GRANTED')
  return { ok: true, user }
}

export async function requireAdminUser(): Promise<User> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  if (!isAdminEmail(user.email)) {
    redirect('/dashboard')
  }

  return user
}

export function getAdminSupabase() {
  return createAdminClient()
}
