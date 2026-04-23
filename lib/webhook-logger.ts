import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface WebhookLogEntry {
  event: string
  status: 'received' | 'processed' | 'error' | 'ignored'
  payload?: unknown
  error?: string
  profile_id?: string
}

export async function logWebhookEvent(entry: WebhookLogEntry): Promise<void> {
  try {
    const supabase = getSupabase()
    await supabase.from('webhook_logs').insert({
      event: entry.event,
      status: entry.status,
      payload: entry.payload ?? null,
      error: entry.error ?? null,
      profile_id: entry.profile_id ?? null,
    })
  } catch {
    // Never throw from logger — silently fail
  }
}
