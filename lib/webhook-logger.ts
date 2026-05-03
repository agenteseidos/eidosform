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
  /** Store only metadata keys, never full payload (P1-INT1: no PII in logs) */
  meta?: Record<string, string | number | boolean | null>
  error?: string
  profile_id?: string
}

export async function logWebhookEvent(entry: WebhookLogEntry): Promise<void> {
  try {
    const supabase = getSupabase()
    await supabase.from('webhook_logs').insert({
      event: entry.event,
      status: entry.status,
      payload: entry.meta ?? null,
      error: entry.error ?? null,
      profile_id: entry.profile_id ?? null,
    })
  } catch {
    // Never throw from logger — silently fail
  }
}
