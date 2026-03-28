import { NextRequest } from 'next/server'
import { User } from '@supabase/supabase-js'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { Database } from '@/lib/database.types'
import { createClient } from '@/lib/supabase/server'

function getBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.slice(7).trim()
  return token || null
}

async function getUserFromBearerToken(token: string): Promise<User | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing Supabase environment variables for request auth.\n' +
      'Required: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY'
    )
  }

  const supabase = createSupabaseClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  })

  const { data, error } = await supabase.auth.getUser()
  if (error) return null
  return data.user ?? null
}

export async function getRequestUser(req: NextRequest): Promise<User | null> {
  const cookieClient = await createClient()
  const { data, error } = await cookieClient.auth.getUser()

  if (!error && data.user) {
    return data.user
  }

  const token = getBearerToken(req)
  if (!token) return null

  return getUserFromBearerToken(token)
}
