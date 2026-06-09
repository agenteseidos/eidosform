#!/usr/bin/env node
/**
 * billing-inspect.mjs — painel ÚNICO de inspeção do estado de cobrança (sandbox OU produção).
 *
 * Mostra, para um email / profileId / customerId, TUDO de uma vez:
 *   - profile: plan, cycle, status, expiry, asaas_subscription_id, cota
 *   - billing_checkouts recentes
 *   - asaas_webhook_events: DLQ (failed) + markers (effects:) + locks
 *   - Asaas: assinaturas em TODOS os status (ACTIVE/INACTIVE) — com value/cycle/nextDue/description
 *   - Asaas: pagamentos agrupados por status (PENDING/CONFIRMED/RECEIVED/REFUNDED/OVERDUE)
 *   - VEREDITO DE LIMPEZA (--cleanup): PASS/FAIL p/ auditoria pós-teste
 *
 * Uso:
 *   ENV_FILE=.env.sandbox.local    node scripts/billing-inspect.mjs <email|id>            # snapshot
 *   ENV_FILE=.env.sandbox.local    node scripts/billing-inspect.mjs <email|id> --watch    # loop 4s
 *   ENV_FILE=.env.production.local node scripts/billing-inspect.mjs <email|id> --cleanup   # auditoria
 *
 * Lê do ambiente: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ASAAS_API_KEY, ASAAS_ENVIRONMENT.
 * ⚠️ NUNCA commitar .env.*.local (estão no .gitignore). Em produção, gere com `vercel env pull`.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

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
const cleanup = process.argv.includes('--cleanup')
if (!arg) { console.error('uso: node scripts/billing-inspect.mjs <email|profileId|customerId> [--watch] [--cleanup]'); process.exit(1) }

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ASAAS_KEY = process.env.ASAAS_API_KEY || process.env.ASAAS_SANDBOX_API_KEY
const ASAAS_ENV = (process.env.ASAAS_ENVIRONMENT || 'sandbox').toLowerCase()
const ASAAS_BASE = ASAAS_ENV === 'production' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3'

if (!SUPA_URL || !SUPA_KEY) { console.error('faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no ambiente'); process.exit(1) }
const db = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } })

const money = (v) => (v == null ? '—' : `R$${Number(v).toFixed(2)}`)
const ts = () => new Date().toLocaleTimeString('pt-BR')
const dt = (v) => (v ? new Date(v).toLocaleString('pt-BR') : '—')

async function asaas(path) {
  if (!ASAAS_KEY) return { _noKey: true }
  const r = await fetch(`${ASAAS_BASE}${path}`, { headers: { access_token: ASAAS_KEY } })
  if (!r.ok) return { _err: `${r.status}` }
  return r.json()
}

async function snapshot() {
  const isEmail = arg.includes('@')
  const isCustomer = arg.startsWith('cus_')
  let profile
  if (isCustomer) {
    ({ data: profile } = await db.from('profiles').select('id, email, plan, plan_cycle, plan_status, plan_expires_at, asaas_customer_id, asaas_subscription_id, responses_used, responses_limit').eq('asaas_customer_id', arg).maybeSingle())
  } else {
    ({ data: profile } = await db.from('profiles').select('id, email, plan, plan_cycle, plan_status, plan_expires_at, asaas_customer_id, asaas_subscription_id, responses_used, responses_limit').eq(isEmail ? 'email' : 'id', arg).maybeSingle())
  }

  console.log(`\n${'═'.repeat(74)}\n  BILLING INSPECT ${ts()}  ·  env=${ASAAS_ENV.toUpperCase()}${ASAAS_ENV === 'production' ? '  💰 DINHEIRO REAL' : ''}\n${'═'.repeat(74)}`)
  if (!profile) { console.log(`  ⚠️  profile não encontrado p/ "${arg}"`); return }

  console.log(`  PROFILE  ${profile.email}`)
  console.log(`    plano:   ${profile.plan} / ${profile.plan_cycle ?? '—'}  ·  status: ${profile.plan_status ?? '—'}`)
  console.log(`    expira:  ${profile.plan_expires_at ?? '—'}`)
  console.log(`    cota:    ${profile.responses_used ?? 0} / ${profile.responses_limit ?? '—'}`)
  console.log(`    asaas:   customer=${profile.asaas_customer_id ?? '—'}  sub=${profile.asaas_subscription_id ?? '—'}`)

  const { data: cks } = await db
    .from('billing_checkouts')
    .select('checkout_id, plan, cycle, status, last_event, asaas_subscription_id, created_at')
    .eq('profile_id', profile.id)
    .order('created_at', { ascending: false })
    .limit(6)
  console.log(`  CHECKOUTS (${cks?.length ?? 0}):`)
  for (const c of cks ?? []) console.log(`    [${c.status}] ${c.plan}/${c.cycle}  sub=${c.asaas_subscription_id ?? '—'}  ${c.last_event ?? ''}  (${dt(c.created_at)})`)

  const { data: evs } = await db
    .from('asaas_webhook_events')
    .select('event_id, event, status, error, attempts, processed_at')
    .order('processed_at', { ascending: false })
    .limit(60)
  const failed = (evs ?? []).filter((e) => e.status === 'failed')
  const markers = (evs ?? []).filter((e) => e.event_id?.startsWith('effects:'))
  const locks = (evs ?? []).filter((e) => e.event_id?.startsWith('lock:'))
  const aligns = (evs ?? []).filter((e) => e.event_id?.startsWith('align-pending:') || e.event_id?.startsWith('formlimit:'))
  console.log(`  WEBHOOK EVENTS:  DLQ(failed)=${failed.length}  markers=${markers.length}  locks=${locks.length}  align/formlimit=${aligns.length}`)
  for (const e of failed.slice(0, 6)) console.log(`    🔴 DLQ ${e.event} ${e.event_id} attempts=${e.attempts} — ${e.error ?? ''}`)
  for (const l of locks) console.log(`    🔒 lock ativo: ${l.event_id} (${dt(l.processed_at)})`)
  for (const a of aligns) console.log(`    🟠 ${a.status} ${a.event_id} — ${a.error ?? ''}`)

  let asaasSubsActive = null
  let asaasPendingCount = null
  if (profile.asaas_customer_id) {
    // Subs em TODOS os status (confirma limpeza: nada ACTIVE sobrando)
    const subs = await asaas(`/subscriptions?customer=${encodeURIComponent(profile.asaas_customer_id)}&limit=20`)
    if (subs._noKey) console.log(`  ASAAS: (sem ASAAS_API_KEY no ambiente — pulando Asaas)`)
    else if (subs._err) console.log(`  ASAAS subs: erro ${subs._err}`)
    else {
      const list = subs.data ?? []
      const active = list.filter((s) => s.status === 'ACTIVE')
      asaasSubsActive = active.length
      const flag = active.length === 0 ? '⚪' : active.length === 1 ? '✅' : '🔴'
      console.log(`  ASAAS SUBS:  ${flag} ${active.length} ACTIVE / ${list.length} total  ${active.length > 1 ? '← POSSÍVEL COBRANÇA DUPLA!' : ''}`)
      for (const s of list) console.log(`    [${s.status}] ${s.id}  ${money(s.value)}  ${s.cycle}  nextDue=${s.nextDueDate}  desc="${s.description ?? ''}"`)
    }
    // Pagamentos agrupados por status (essencial p/ estorno + limpeza)
    const pays = await asaas(`/payments?customer=${encodeURIComponent(profile.asaas_customer_id)}&limit=30`)
    if (!pays._noKey && !pays._err) {
      const list = pays.data ?? []
      const byStatus = {}
      for (const p of list) (byStatus[p.status] ??= []).push(p)
      asaasPendingCount = (byStatus.PENDING ?? []).length + (byStatus.OVERDUE ?? []).length
      console.log(`  ASAAS PAGAMENTOS (${list.length}):  ${Object.entries(byStatus).map(([k, v]) => `${k}=${v.length}`).join('  ') || '—'}`)
      for (const p of list.slice(0, 8)) console.log(`    [${p.status}] ${money(p.value)}  venc=${p.dueDate}  ${p.refunds?.length ? `↩estorno(${p.refunds.length})` : ''}  ${p.id}`)
    } else if (pays._err) console.log(`  ASAAS pagamentos: erro ${pays._err}`)
  }

  if (cleanup) {
    console.log(`  ${'─'.repeat(70)}`)
    const checks = [
      ['profile.plan = free', profile.plan === 'free'],
      ['profile.asaas_subscription_id = null', profile.asaas_subscription_id == null],
      ['Asaas: 0 subs ACTIVE', asaasSubsActive === 0],
      ['Asaas: 0 pagamentos PENDING/OVERDUE', asaasPendingCount === 0],
      ['0 eventos DLQ (failed)', failed.length === 0],
      ['0 locks ativos', locks.length === 0],
    ]
    const allPass = checks.every(([, ok]) => ok === true)
    console.log(`  🧹 VEREDITO DE LIMPEZA: ${allPass ? '✅ PASS — tudo limpo' : '🔴 FAIL — revisar abaixo'}`)
    for (const [label, ok] of checks) console.log(`     ${ok === true ? '✅' : ok === null ? '⚠️ (sem dado)' : '🔴'} ${label}`)
  }
}

if (watch) {
  console.log(`👀 watch mode (a cada 4s) — Ctrl+C p/ sair`)
  for (;;) { await snapshot().catch((e) => console.error('erro:', e.message)); await new Promise((r) => setTimeout(r, 4000)) }
} else {
  await snapshot().catch((e) => { console.error('erro:', e.message); process.exit(1) })
}
