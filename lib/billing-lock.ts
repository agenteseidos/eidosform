import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

/**
 * Lock por chave para serializar operações de billing concorrentes.
 *
 * ANTES (até 28/08/2026): marcador em `asaas_webhook_events` (`event_id` UNIQUE), TTL fixo de
 * 2 min, e `releaseLock` apagava a linha PELA CHAVE — sem saber se ainda era o dono. Sequência
 * possível e real: A adquire → A demora além do TTL (as escritas no Asaas não têm timeout, é
 * deliberado em lib/asaas.ts) → B toma o lock stale → A termina e apaga o lock de B → C entra
 * junto com B. Dois executores no mesmo perfil.
 *
 * AGORA: tabela `billing_locks` com `owner_token`. Quem adquire recebe um token; o release só
 * apaga se o token bater; o heartbeat só estende se o token bater; e as mutações finais podem
 * exigir a posse (`holdsLock`) antes de escrever — é o fencing.
 *
 * Compatibilidade: `acquireLock` devolve o token (string) ou null. Como `if (!(await acquire))`
 * lê string como verdadeiro e null como falso, os call sites antigos seguem corretos; o que muda
 * é que agora eles DEVEM guardar o token e passá-lo ao `releaseLock`.
 */

/** Tempo de posse. Mantido igual ao STALE_MS anterior de propósito: mudar o TTL junto com o
 *  mecanismo misturaria duas alterações de comportamento numa só. */
const DEFAULT_TTL_MS = 120_000

function tbl(db: SupabaseClient) {
  return db.from('billing_locks')
}

/**
 * Adquire o lock. Devolve o `owner_token` (guarde-o!) ou null se outro executor está com ele
 * e o lease ainda é válido. Toma o lock de um lease VENCIDO — takeover só depois de vencer.
 */
export async function acquireLock(
  db: SupabaseClient,
  key: string,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<string | null> {
  const ownerToken = randomUUID()
  const now = Date.now()
  const leaseUntil = new Date(now + ttlMs).toISOString()

  // 1) Tentativa direta: ninguém tem a chave.
  const { error } = await tbl(db).insert({
    lock_key: key,
    owner_token: ownerToken,
    lease_until: leaseUntil,
    updated_at: new Date(now).toISOString(),
  })
  if (!error) return ownerToken
  if (error.code !== '23505') return null // erro inesperado → NÃO assume o lock

  // 2) Existe. Só toma se o lease já venceu — e de forma atômica: o UPDATE condicional só
  //    afeta 1 linha para UM dos concorrentes (o outro recebe 0 linhas e desiste).
  const { data } = await tbl(db)
    .update({ owner_token: ownerToken, lease_until: leaseUntil, updated_at: new Date(now).toISOString() })
    .eq('lock_key', key)
    .lt('lease_until', new Date(now).toISOString())
    .select('lock_key')

  return Array.isArray(data) && data.length > 0 ? ownerToken : null
}

/**
 * Estende o lease — só para o dono. Devolve false se a posse foi perdida (outro executor tomou
 * o lock depois do vencimento): nesse caso o chamador deve ABORTAR, não continuar escrevendo.
 * Usar em operações longas (ativação paga fala com o Asaas sem timeout).
 */
export async function heartbeatLock(
  db: SupabaseClient,
  key: string,
  ownerToken: string,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<boolean> {
  const { data } = await tbl(db)
    .update({ lease_until: new Date(Date.now() + ttlMs).toISOString(), updated_at: new Date().toISOString() })
    .eq('lock_key', key)
    .eq('owner_token', ownerToken)
    .select('lock_key')
  return Array.isArray(data) && data.length > 0
}

/** Ainda sou o dono E o lease está de pé? Cheque isto imediatamente antes de uma mutação final. */
export async function holdsLock(
  db: SupabaseClient,
  key: string,
  ownerToken: string
): Promise<boolean> {
  const { data } = await tbl(db)
    .select('lock_key')
    .eq('lock_key', key)
    .eq('owner_token', ownerToken)
    .gt('lease_until', new Date().toISOString())
    .limit(1)
  return Array.isArray(data) && data.length > 0
}

/**
 * Libera o lock. Com `ownerToken`, só apaga se ainda for seu — é o que impede apagar o lock de
 * outro executor. Sem token (chamada legada), apaga pela chave: mantido para não quebrar call
 * sites antigos, mas TODO caminho novo deve passar o token.
 */
export async function releaseLock(
  db: SupabaseClient,
  key: string,
  ownerToken?: string | null
): Promise<void> {
  try {
    const q = tbl(db).delete().eq('lock_key', key)
    if (ownerToken && typeof ownerToken === 'string') {
      await q.eq('owner_token', ownerToken)
    } else {
      await q
    }
  } catch {
    /* best-effort: lease vencido é retomado pelo próximo acquire */
  }
}
