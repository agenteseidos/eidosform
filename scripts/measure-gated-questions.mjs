#!/usr/bin/env node
/**
 * measure-gated-questions.mjs — mede o impacto de gatear Calendly (starter+) e
 * html_block (plus+): quantos forms PUBLICADOS usam esses tipos e cairiam abaixo
 * do plano necessário (effective plan, considerando expiração).
 *
 * Uso: ENV_FILE=.env.production.local node scripts/measure-gated-questions.mjs
 * Só leitura. Não altera nada.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

function loadEnvFile(path) {
  try {
    for (const raw of readFileSync(path, 'utf8').split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('='); if (eq < 0) continue
      const key = line.slice(0, eq).trim()
      let val = line.slice(eq + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
      if (key && !process.env[key]) process.env[key] = val
    }
  } catch { /* opcional */ }
}
loadEnvFile(process.env.ENV_FILE || '.env.production.local')

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPA_URL || !SUPA_KEY) { console.error('faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
const sb = createClient(SUPA_URL, SUPA_KEY)

// effective plan: plano pago expirado vira free
function effectivePlan(profile) {
  const plan = profile?.plan || 'free'
  if (plan === 'free') return 'free'
  const exp = profile?.plan_expires_at
  if (exp && new Date(exp).getTime() < Date.now()) return 'free'
  return plan
}

const PLAN_RANK = { free: 0, starter: 1, plus: 2, professional: 3 }
function hasAtLeast(plan, min) { return (PLAN_RANK[plan] ?? 0) >= (PLAN_RANK[min] ?? 0) }

const { data: forms, error } = await sb
  .from('forms')
  .select('id, slug, title, status, user_id, questions')
if (error) { console.error('erro forms:', error.message); process.exit(1) }

const { data: profiles, error: pErr } = await sb
  .from('profiles')
  .select('id, email, plan, plan_status, plan_expires_at')
if (pErr) { console.error('erro profiles:', pErr.message); process.exit(1) }
const profById = new Map(profiles.map(p => [p.id, p]))

const calendlyAffected = []
const htmlAffected = []
let formsWithCalendly = 0
let formsWithHtml = 0

for (const f of forms) {
  const qs = Array.isArray(f.questions) ? f.questions : []
  const hasCalendly = qs.some(q => q?.type === 'calendly')
  const hasHtml = qs.some(q => q?.type === 'html_block')
  if (!hasCalendly && !hasHtml) continue
  const prof = profById.get(f.user_id)
  const eff = effectivePlan(prof)
  if (hasCalendly) {
    formsWithCalendly++
    if (!hasAtLeast(eff, 'starter')) calendlyAffected.push({ slug: f.slug, status: f.status, plan: eff, email: prof?.email })
  }
  if (hasHtml) {
    formsWithHtml++
    if (!hasAtLeast(eff, 'plus')) htmlAffected.push({ slug: f.slug, status: f.status, plan: eff, email: prof?.email })
  }
}

const pub = arr => arr.filter(x => x.status === 'published')

console.log('════════════════════════════════════════════════════════')
console.log('  IMPACTO DE GATEAR Calendly (starter+) e html_block (plus+)')
console.log('════════════════════════════════════════════════════════')
console.log(`  Total de forms no banco: ${forms.length}`)
console.log('  ──────────────────────────────────────────────────────')
console.log(`  CALENDLY — forms que usam: ${formsWithCalendly}`)
console.log(`     afetados (plano < starter): ${calendlyAffected.length}  | PUBLICADOS: ${pub(calendlyAffected).length}`)
for (const a of calendlyAffected) console.log(`       - /${a.slug} [${a.status}] plano=${a.plan} dono=${a.email}`)
console.log('  ──────────────────────────────────────────────────────')
console.log(`  HTML_BLOCK — forms que usam: ${formsWithHtml}`)
console.log(`     afetados (plano < plus): ${htmlAffected.length}  | PUBLICADOS: ${pub(htmlAffected).length}`)
for (const a of htmlAffected) console.log(`       - /${a.slug} [${a.status}] plano=${a.plan} dono=${a.email}`)
console.log('════════════════════════════════════════════════════════')
