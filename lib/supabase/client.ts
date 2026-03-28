'use client'

import { createBrowserClient } from '@supabase/ssr'
import { Database } from '@/lib/database.types'

// Lazy client singleton — created only in browser
let client: ReturnType<typeof createBrowserClient<Database>> | null = null

export function createClient() {
  if (typeof window === 'undefined') {
    // During SSR prerender, return a minimal no-op proxy so server render doesn't throw
    // The real client is created client-side only
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key'
    return createBrowserClient<Database>(url, key)
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing Supabase environment variables. Please check your .env.local file.\n' +
      'Required: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY'
    )
  }

  if (!client) {
    client = createBrowserClient<Database>(supabaseUrl, supabaseAnonKey)
  }
  return client
}
