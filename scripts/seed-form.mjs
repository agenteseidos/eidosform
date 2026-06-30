// Motor de criação de formulário (migração) — insere um form no EidosForm a partir de um spec JSON,
// via service-role (bypassa RLS). Reutilizável: é a "última milha" de toda migração.
//
// Uso:
//   ENV_FILE=.env.production.local node scripts/seed-form.mjs <spec.json> [--publish]
//
// Sem --publish, cria como RASCUNHO. Idempotente: aborta se já existir form com o mesmo slug pro dono.
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

function loadEnv(path) {
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[m[1]] = v
  }
  return out
}

const envFile = process.env.ENV_FILE
const specPath = process.argv[2]
const publish = process.argv.includes('--publish')
if (!envFile || !specPath) {
  console.error('Uso: ENV_FILE=.env.production.local node scripts/seed-form.mjs <spec.json> [--publish]')
  process.exit(1)
}

const env = loadEnv(envFile)
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no ENV_FILE')
  process.exit(1)
}

const spec = JSON.parse(readFileSync(specPath, 'utf8'))
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// 1) resolve o dono pelo e-mail
const { data: profile, error: pErr } = await supabase
  .from('profiles').select('id, email, plan').eq('email', spec.ownerEmail).single()
if (pErr || !profile) {
  console.error('Owner NÃO encontrado:', spec.ownerEmail, pErr?.message || '')
  process.exit(1)
}
console.log(`Owner: ${profile.email} | id: ${profile.id} | plano: ${profile.plan}`)

// 2) idempotência — não duplicar (ou --replace se já existir, desde que 0 respostas)
const { data: existing } = await supabase
  .from('forms').select('id, status').eq('user_id', profile.id).eq('slug', spec.slug).maybeSingle()
if (existing) {
  if (!process.argv.includes('--replace')) {
    console.error(`JÁ EXISTE form slug="${spec.slug}" (id ${existing.id}, status ${existing.status}). Use --replace p/ substituir.`)
    process.exit(1)
  }
  const { count } = await supabase
    .from('responses').select('id', { count: 'exact', head: true }).eq('form_id', existing.id)
  if (count && count > 0) {
    console.error(`Form "${spec.slug}" tem ${count} resposta(s) — NÃO vou apagar (perda de dados). Aborte.`)
    process.exit(1)
  }
  const { error: delErr } = await supabase.from('forms').delete().eq('id', existing.id)
  if (delErr) { console.error('Erro ao deletar form anterior:', delErr.message); process.exit(1) }
  console.log(`--replace: form anterior deletado (0 respostas): ${existing.id}`)
}

// 3) monta as perguntas com UUID por pergunta (+ resolve showIf -> conditionalLogic)
const keyToId = {}
const built = spec.questions.map((q) => {
  const id = randomUUID()
  if (q.key) keyToId[q.key] = id
  const out = { id, type: q.type, title: q.title, required: !!q.required }
  if (q.description) out.description = q.description
  if (q.placeholder) out.placeholder = q.placeholder
  if (q.options) out.options = q.options
  if (q.allowOther != null) out.allowOther = q.allowOther
  if (q.defaultCountry) out.defaultCountry = q.defaultCountry
  if (q.minValue != null) out.minValue = q.minValue
  if (q.maxValue != null) out.maxValue = q.maxValue
  return { out, q }
})
// segundo passo: conditionalLogic (showIf precisa dos ids já gerados acima)
for (const { out, q } of built) {
  if (q.showIf) {
    const targetId = keyToId[q.showIf.question]
    if (!targetId) { console.error(`showIf aponta p/ key inexistente: "${q.showIf.question}"`); process.exit(1) }
    out.conditionalLogic = { questionId: targetId, operator: q.showIf.operator || 'equals', value: q.showIf.equals }
  }
}
const questions = built.map((b) => b.out)

// 4) payload do form (insert-only — não toca em nada existente)
const row = {
  user_id: profile.id,
  title: spec.title,
  slug: spec.slug,
  status: publish ? 'published' : 'draft',
  theme: spec.theme || 'minimal',
  plan: profile.plan || 'free',
  questions,
  version: 0,
}
if (spec.welcome) {
  row.welcome_enabled = true
  row.welcome_title = spec.welcome.title
  row.welcome_description = spec.welcome.description
  row.welcome_button_text = spec.welcome.buttonText
}
if (spec.thankYou) {
  row.thank_you_enabled = true
  row.thank_you_title = spec.thankYou.title
  row.thank_you_description = spec.thankYou.description
  row.thank_you_message = spec.thankYou.title
  row.thank_you_button_text = spec.thankYou.buttonText || null
  let btnUrl = spec.thankYou.buttonUrl || null
  if (spec.thankYou.whatsapp) {
    btnUrl = `https://wa.me/${spec.thankYou.whatsapp.number}?text=${encodeURIComponent(spec.thankYou.whatsapp.text)}`
  }
  row.thank_you_button_url = btnUrl
}

const { data: created, error: cErr } = await supabase
  .from('forms').insert(row).select('id, slug, status').single()
if (cErr) {
  console.error('ERRO ao criar:', cErr.message)
  process.exit(1)
}
console.log('✅ Form criado:', created)
console.log(`URL pública: https://eidosform.com.br/f/${created.slug}  (${created.status})`)
