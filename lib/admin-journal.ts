/**
 * lib/admin-journal.ts — escrita no journal append-only de ações do admin.
 *
 * BEST-EFFORT por enquanto: se a tabela ainda não existir (migration
 * 20260730_admin_actions_journal.sql pendente) ou a escrita falhar, a ação
 * administrativa NÃO é bloqueada — só loga em erro alto. Quando a Fase 4
 * (mutações no Asaas) chegar, o registro vira PRÉ-REQUISITO da operação
 * (estado 'requested' antes de tocar o gateway) e deixa de ser opcional.
 *
 * NUNCA passar token de cartão ou payload sensível em before/after.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/lib/database.types'
import { logError } from '@/lib/logger'

export type AdminActionEntry = {
  actorId: string
  actorEmail: string
  targetUserId: string
  targetEmail?: string | null
  action: 'plan_change' | 'expiry_adjust' | 'account_delete'
  reason: string
  state?: 'completed' | 'failed' | 'reconcile_required'
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  subscriptionId?: string | null
  error?: string | null
}

export async function recordAdminAction(entry: AdminActionEntry): Promise<void> {
  try {
    const supabase = createAdminClient()
    const { error } = await supabase.from('admin_actions').insert({
      actor_id: entry.actorId,
      actor_email: entry.actorEmail,
      target_user_id: entry.targetUserId,
      target_email: entry.targetEmail ?? null,
      action: entry.action,
      reason: entry.reason,
      state: entry.state ?? 'completed',
      before: (entry.before ?? null) as Json,
      after: (entry.after ?? null) as Json,
      subscription_id: entry.subscriptionId ?? null,
      error: entry.error ?? null,
    })
    if (error) {
      logError('[admin-journal] Falha ao registrar ação admin (não bloqueante)', error, {
        action: entry.action,
        targetUserId: entry.targetUserId,
      })
    }
  } catch (err) {
    logError('[admin-journal] Exceção ao registrar ação admin (não bloqueante)', err, {
      action: entry.action,
      targetUserId: entry.targetUserId,
    })
  }
}
