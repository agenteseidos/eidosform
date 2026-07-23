#!/usr/bin/env node
/**
 * sandbox-watch.mjs — acompanha o estado de pagamento no SANDBOX durante testes manuais.
 *
 * Tira um snapshot do que importa após cada ação (compra/upgrade/cancelamento):
 *   - profile: plan, cycle, status, expiry, asaas_subscription_id, cota
 *   - billing_checkouts recentes (status de cada checkout)
 *   - asaas_webhook_events: DLQ (failed) + markers de dedup (effects:) + locks (lock:)
 *   - Asaas: assinaturas ACTIVE do cliente + CHECAGEM DA INVARIANTE (1 ACTIVE, valor certo)
 *
 * Uso:
 *   node scripts/sandbox-watch.mjs <email-ou-profileId>           # snapshot único
 *   node scripts/sandbox-watch.mjs <email-ou-profileId> --watch   # loop a cada 4s
 *
 * Lê as chaves do ambiente (ex.: após `vercel env pull .env.sandbox.local` + `set -a; . .env.sandbox.local`):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ASAAS_API_KEY, ASAAS_ENVIRONMENT
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

// Carrega .env.sandbox.local de forma ROBUSTA (trim de espaço após '=', preserva '$' literal
// da chave Asaas, ignora aspas) — sem depender de `set -a; . file` do shell, que quebra com
// espaço depois do '=' e expande '$...'.
function loadEnvFile(path) {
  try {
    for (const raw of readFileSync(path, 'utf8').split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq < 0) continue
      const key = line.slice(0, eq).trim()
      let val = line.slice(eq + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
      if (key && !process.env[key]) process.env[key] = val
    }
  } catch { /* arquivo opcional */ }
}
loadEnvFile(process.env.ENV_FILE || '.env.sandbox.local')

const arg = process.argv[2]
const watch = process.argv.includes('--watch')
if (!arg) { console.error('uso: node scripts/sandbox-watch.mjs <email-ou-profileId> [--watch]'); process.exit(1) }

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ASAAS_KEY = process.env.ASAAS_API_KEY || process.env.ASAAS_SANDBOX_API_KEY
const ASAAS_ENV = (process.env.ASAAS_ENVIRONMENT || 'sandbox').toLowerCase()
const ASAAS_BASE = ASAAS_ENV === 'production' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3'

if (!SUPA_URL || !SUPA_KEY) { console.error('faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no ambiente'); process.exit(1) }
const db = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } })

const money = (v) => (v == null ? '—' : `R$${Number(v).toFixed(2)}`)
const ts = () => new Date().toLocaleTimeString('pt-BR')

async function asaas(path) {
  if (!ASAAS_KEY) return { _noKey: true }
  const r = await fetch(`${ASAAS_BASE}${path}`, { headers: { access_token: ASAAS_KEY } })
  if (!r.ok) return { _err: `${r.status}` }
  return r.json()
}

async function snapshot() {
  const isEmail = arg.includes('@')
  const { data: profile } = await db
    .from('profiles')
    .select('id, email, plan, plan_cycle, plan_status, plan_expires_at, asaas_customer_id, asaas_subscription_id, responses_used, responses_limit')
    .eq(isEmail ? 'email' : 'id', arg)
    .maybeSingle()

  console.log(`\n${'═'.repeat(72)}\n  SNAPSHOT ${ts()}  ·  env=${ASAAS_ENV}\n${'═'.repeat(72)}`)
  if (!profile) { console.log(`  ⚠️  profile não encontrado p/ "${arg}"`); return }

  console.log(`  PROFILE  ${profile.email}`)
  console.log(`    plano:   ${profile.plan} / ${profile.plan_cycle ?? '—'}  ·  status: ${profile.plan_status ?? '—'}`)
  console.log(`    expira:  ${profile.plan_expires_at ?? '—'}`)
  console.log(`    cota:    ${profile.responses_used ?? 0} / ${profile.responses_limit ?? '—'}`)
  console.log(`    asaas:   customer=${profile.asaas_customer_id ?? '—'}  sub=${profile.asaas_subscription_id ?? '—'}`)

  // billing_checkouts recentes
  const { data: cks } = await db
    .from('billing_checkouts')
    .select('checkout_id, plan, cycle, status, last_event, asaas_subscription_id, created_at')
    .eq('profile_id', profile.id)
    .order('created_at', { ascending: false })
    .limit(6)
  console.log(`  CHECKOUTS (${cks?.length ?? 0}):`)
  for (const c of cks ?? []) {
    console.log(`    [${c.status}] ${c.plan}/${c.cycle}  sub=${c.asaas_subscription_id ?? '—'}  ${c.last_event ?? ''}  (${new Date(c.created_at).toLocaleString('pt-BR')})`)
  }

  // asaas_webhook_events: DLQ + markers + locks
  const { data: evs } = await db
    .from('asaas_webhook_events')
    .select('event_id, event, status, error, attempts, processed_at')
    .order('processed_at', { ascending: false })
    .limit(40)
  const failed = (evs ?? []).filter((e) => e.status === 'failed')
  const markers = (evs ?? []).filter((e) => e.event_id?.startsWith('effects:'))
  const locks = (evs ?? []).filter((e) => e.event_id?.startsWith('lock:'))
  console.log(`  WEBHOOK EVENTS:  DLQ(failed)=${failed.length}  markers(effects:)=${markers.length}  locks=${locks.length}`)
  for (const e of failed.slice(0, 5)) console.log(`    🔴 DLQ ${e.event} ${e.event_id} attempts=${e.attempts} — ${e.error ?? ''}`)
  if (locks.length) for (const l of locks) console.log(`    🔒 lock ativo: ${l.event_id} (${l.processed_at})`)

  // Asaas: assinaturas ACTIVE do cliente — INVARIANTE "nunca cobrar em dobro"
  if (profile.asaas_customer_id) {
    const subs = await asaas(`/subscriptions?customer=${encodeURIComponent(profile.asaas_customer_id)}&status=ACTIVE&limit=20`)
    if (subs._noKey) console.log(`  ASAAS: (sem ASAAS_API_KEY no ambiente — pulando verificação de subs)`)
    else if (subs._err) console.log(`  ASAAS: erro ${subs._err}`)
    else {
      const list = subs.data ?? []
      const flag = list.length === 0 ? '⚪' : list.length === 1 ? '✅' : '🔴'
      console.log(`  ASAAS ACTIVE subs: ${flag} ${list.length}  ${list.length > 1 ? '← POSSÍVEL COBRANÇA DUPLA!' : ''}`)
      for (const s of list) console.log(`    ${s.id}  ${money(s.value)}  ${s.cycle}  nextDue=${s.nextDueDate}  desc="${s.description ?? ''}"`)
    }
  }
}

if (watch) {
  console.log(`👀 watch mode (a cada 4s) — Ctrl+C p/ sair`)
  for (;;) { await snapshot().catch((e) => console.error('erro:', e.message)); await new Promise((r) => setTimeout(r, 4000)) }
} else {
  await snapshot().catch((e) => { console.error('erro:', e.message); process.exit(1) })
}
