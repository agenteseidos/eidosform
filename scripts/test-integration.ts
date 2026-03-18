/**
 * scripts/test-integration.ts
 * Testes de integração EidosForm
 * 
 * Uso:
 *   BASE_URL=http://localhost:3000 USER_TOKEN=<jwt> npx ts-node scripts/test-integration.ts
 * 
 * O USER_TOKEN é o JWT do Supabase Auth (access_token).
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const USER_TOKEN = process.env.USER_TOKEN ?? ''
const API_KEY = process.env.API_KEY ?? '' // Para testar API pública

let passed = 0
let failed = 0
const errors: string[] = []

function log(msg: string) {
  console.log(`[test] ${msg}`)
}

function ok(test: string) {
  passed++
  console.log(`  ✅ ${test}`)
}

function fail(test: string, detail?: string) {
  failed++
  const msg = detail ? `${test}: ${detail}` : test
  console.log(`  ❌ ${msg}`)
  errors.push(msg)
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  }
  if (USER_TOKEN) headers['Authorization'] = `Bearer ${USER_TOKEN}`

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

async function runTests() {
  console.log(`\n🚀 EidosForm Integration Tests — ${BASE_URL}\n`)

  // ============================================================
  // 1. Criar formulário
  // ============================================================
  log('1. Criar formulário')
  const { status: s1, body: b1 } = await apiFetch('/api/forms', {
    method: 'POST',
    body: JSON.stringify({ title: '[TEST] Integration Form', description: 'Auto-generated test form' }),
  })

  if (s1 === 201 && b1.form?.id) {
    ok('POST /api/forms → 201')
  } else {
    fail('POST /api/forms', `status=${s1}, body=${JSON.stringify(b1)}`)
    console.log('\n❌ Teste interrompido: não foi possível criar form.\n')
    return
  }

  const formId = b1.form.id
  log(`   Form ID: ${formId}`)

  // ============================================================
  // 2. Adicionar perguntas
  // ============================================================
  log('2. Adicionar perguntas')
  const questions = [
    { id: 'q1', type: 'short_text', title: 'Qual o seu nome?', required: true },
    { id: 'q2', type: 'email', title: 'Qual o seu e-mail?', required: true },
    { id: 'q3', type: 'multiple_choice', title: 'Como nos encontrou?', required: false, options: ['Google', 'Indicação', 'Redes sociais'] },
  ]

  const { status: s2, body: b2 } = await apiFetch(`/api/forms/${formId}`, {
    method: 'PATCH',
    body: JSON.stringify({ questions }),
  })

  if (s2 === 200) {
    ok(`PATCH /api/forms/${formId} → 200 (questions saved)`)
  } else {
    fail(`PATCH /api/forms/${formId}`, `status=${s2}`)
  }

  // ============================================================
  // 3. Publicar formulário
  // ============================================================
  log('3. Publicar formulário')
  const { status: s3 } = await apiFetch(`/api/forms/${formId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'published' }),
  })

  if (s3 === 200) {
    ok(`PATCH /api/forms/${formId} → 200 (published)`)
  } else {
    fail(`PATCH /api/forms/${formId} status=published`, `status=${s3}`)
  }

  // ============================================================
  // 4. Submeter resposta parcial (simulando player)
  // ============================================================
  log('4. Submeter resposta parcial')
  const { status: s4, body: b4 } = await fetch(`${BASE_URL}/api/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      form_id: formId,
      answers: { q1: 'Test User' },
      completed: false,
      last_question_answered: 'q1',
    }),
  }).then(async r => ({ status: r.status, body: await r.json() }))

  if ((s4 === 201 || s4 === 200) && b4.response_id) {
    ok(`POST /api/responses (partial) → ${s4}`)
  } else {
    fail('POST /api/responses (partial)', `status=${s4}`)
  }

  const partialResponseId = b4.response_id

  // ============================================================
  // 5. Completar resposta (upsert)
  // ============================================================
  log('5. Completar resposta (upsert via x-response-id)')
  const { status: s5, body: b5 } = await fetch(`${BASE_URL}/api/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-response-id': partialResponseId },
    body: JSON.stringify({
      form_id: formId,
      answers: { q1: 'Test User', q2: 'test@example.com', q3: 'Google' },
      completed: true,
      last_question_answered: 'q3',
    }),
  }).then(async r => ({ status: r.status, body: await r.json() }))

  if (s5 === 200 && b5.response_id === partialResponseId) {
    ok(`POST /api/responses (complete upsert) → 200`)
  } else {
    fail('POST /api/responses (upsert)', `status=${s5}, body=${JSON.stringify(b5)}`)
  }

  // ============================================================
  // 6. Verificar resposta salva
  // ============================================================
  log('6. Verificar resposta via analytics')
  const { status: s6, body: b6 } = await apiFetch(`/api/forms/${formId}/analytics`)

  if (s6 === 200 && b6.total_responses >= 1) {
    ok(`GET /api/forms/${formId}/analytics → total=${b6.total_responses}, rate=${b6.completion_rate}%`)
  } else {
    fail(`GET /api/forms/${formId}/analytics`, `status=${s6}`)
  }

  // ============================================================
  // 7. Exportar CSV
  // ============================================================
  log('7. Exportar CSV')
  const csvRes = await fetch(`${BASE_URL}/api/forms/${formId}/export-csv`, {
    headers: { 'Authorization': `Bearer ${USER_TOKEN}` },
  })

  if (csvRes.status === 200) {
    const csv = await csvRes.text()
    const lines = csv.trim().split('\n')
    if (lines.length >= 2) {
      ok(`GET /api/forms/${formId}/export-csv → ${lines.length - 1} response(s)`)
    } else {
      fail('export-csv', 'CSV has no data rows')
    }
  } else {
    fail(`GET /api/forms/${formId}/export-csv`, `status=${csvRes.status}`)
  }

  // ============================================================
  // 8. API pública v1 (se API_KEY fornecida)
  // ============================================================
  if (API_KEY) {
    log('8. API pública v1')
    const { status: s8, body: b8 } = await fetch(`${BASE_URL}/api/v1/forms`, {
      headers: { 'X-API-Key': API_KEY },
    }).then(async r => ({ status: r.status, body: await r.json() }))

    if (s8 === 200 && Array.isArray(b8.forms)) {
      ok(`GET /api/v1/forms → ${b8.forms.length} form(s)`)
    } else {
      fail('GET /api/v1/forms', `status=${s8}`)
    }
  } else {
    log('8. API pública v1 — pulada (API_KEY não definida)')
  }

  // ============================================================
  // Resumo
  // ============================================================
  console.log('\n' + '='.repeat(50))
  console.log(`✅ Passed: ${passed}  ❌ Failed: ${failed}`)
  if (errors.length > 0) {
    console.log('\nFalhas:')
    errors.forEach(e => console.log(`  - ${e}`))
  }
  console.log('')

  process.exit(failed > 0 ? 1 : 0)
}

runTests().catch(e => {
  console.error('Test runner error:', e)
  process.exit(1)
})
