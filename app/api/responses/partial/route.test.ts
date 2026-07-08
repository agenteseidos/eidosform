import { describe, it, expect, vi, beforeEach } from 'vitest'
import { signPartialToken } from '@/lib/partial-token'

// Contrato do A1 no nível da rota: criar parcial emite partial_token; UPDATE
// exige o token; token ausente/errado degrada para CRIAR nova resposta (nunca
// sobrescreve a de terceiro, nunca derruba o lead).

// ── Estado mutável que os mocks consultam ─────────────────────────────────────
type Result = { data?: unknown; error?: unknown }
const state: {
  form: Result
  existingResponse: Result
  insertResult: Result
  updateResult: Result
  // Fila de resultados pros SELECTs de responses (consumida em ordem) —
  // permite simular corrida: 1º select não acha, re-select pós-23505 acha.
  selectQueue: Result[]
  calls: Array<{ table: string; op: string; payload?: unknown }>
} = {
  form: { data: null, error: null },
  existingResponse: { data: null, error: null },
  insertResult: { data: null, error: null },
  updateResult: { data: [{ id: 'updated' }], error: null },
  selectQueue: [],
  calls: [],
}

function makeBuilder(table: string) {
  const b: Record<string, unknown> & { _op: string; _payload?: unknown } = { _op: 'select' }
  const chain = () => b
  b.select = chain
  b.eq = chain
  b.or = chain
  b.single = chain
  b.maybeSingle = chain
  b.insert = (p: unknown) => { b._op = 'insert'; b._payload = p; return b }
  b.update = (p: unknown) => { b._op = 'update'; b._payload = p; return b }
  b.delete = () => { b._op = 'delete'; return b }
  // thenable: resolve com o resultado configurado para (table, op)
  b.then = (resolve: (r: Result) => unknown) => {
    state.calls.push({ table, op: b._op, payload: b._payload })
    let res: Result = { data: null, error: null }
    if (table === 'forms' && b._op === 'select') res = state.form
    if (table === 'responses' && b._op === 'select') {
      res = state.selectQueue.length > 0 ? state.selectQueue.shift()! : state.existingResponse
    }
    if (table === 'responses' && b._op === 'insert') res = state.insertResult
    if (table === 'responses' && b._op === 'update') res = state.updateResult
    return Promise.resolve(res).then(resolve)
  }
  return b
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: (t: string) => makeBuilder(t) }),
}))
vi.mock('@/lib/response-rate-limit', () => ({
  checkResponseRateLimitAsync: vi.fn(async () => ({ allowed: true, remaining: 9, resetIn: 0 })),
  checkPartialRateLimitAsync: vi.fn(async () => ({ allowed: true, remaining: 29, resetIn: 0 })),
}))
vi.mock('@/lib/google-sheets', () => ({ upsertSubmission: vi.fn(async () => ({ rowIndex: null })) }))
vi.mock('@/lib/logger', () => ({ logError: vi.fn(), logWarn: vi.fn(), log: vi.fn() }))

import { POST } from './route'
import { upsertSubmission } from '@/lib/google-sheets'

const FORM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const RESP_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const NEW_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const formRow = {
  id: FORM_ID,
  user_id: 'owner-1',
  questions: [{ id: 'q1', type: 'short_text', title: 'Nome' }],
  status: 'published',
  is_closed: false,
  paused: false,
  google_sheets_enabled: false,
  google_sheets_id: null,
}

function makeReq(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/responses/partial', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest
}

beforeEach(() => {
  process.env.PARTIAL_TOKEN_SECRET = 'test-secret'
  state.form = { data: formRow, error: null }
  state.existingResponse = { data: null, error: null }
  state.insertResult = { data: { id: NEW_ID }, error: null }
  state.updateResult = { data: [{ id: 'updated' }], error: null }
  state.selectQueue = []
  state.calls = []
  vi.mocked(upsertSubmission).mockClear()
})

const SESSION_KEY = '550e8400-e29b-41d4-a716-446655440000'

describe('POST /api/responses/partial', () => {
  it('cria parcial e devolve response_id + partial_token válido', async () => {
    const res = await POST(makeReq({ form_id: FORM_ID, answers: { q1: 'Sidney' } }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.response_id).toBe(NEW_ID)
    expect(body.partial_token).toBe(signPartialToken(NEW_ID))
  })

  it('UPDATE com token válido atualiza a row existente', async () => {
    state.existingResponse = {
      data: { id: RESP_ID, sheets_row_index: null, form_id: FORM_ID, completed: false },
      error: null,
    }
    const res = await POST(
      makeReq(
        { form_id: FORM_ID, answers: { q1: 'Editado' } },
        { 'x-response-id': RESP_ID, 'x-partial-token': signPartialToken(RESP_ID) }
      )
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.response_id).toBe(RESP_ID)
    expect(state.calls.some(c => c.table === 'responses' && c.op === 'update')).toBe(true)
  })

  it('UPDATE SEM token NÃO sobrescreve — cria resposta nova (anti-IDOR)', async () => {
    state.existingResponse = {
      data: { id: RESP_ID, sheets_row_index: null, form_id: FORM_ID, completed: false },
      error: null,
    }
    const res = await POST(
      makeReq({ form_id: FORM_ID, answers: { q1: 'Ataque' } }, { 'x-response-id': RESP_ID })
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.response_id).toBe(NEW_ID) // nova row, não a vítima
    expect(state.calls.some(c => c.table === 'responses' && c.op === 'update')).toBe(false)
  })

  it('UPDATE com token de OUTRA response cria nova em vez de atualizar', async () => {
    state.existingResponse = {
      data: { id: RESP_ID, sheets_row_index: null, form_id: FORM_ID, completed: false },
      error: null,
    }
    const res = await POST(
      makeReq(
        { form_id: FORM_ID, answers: { q1: 'Ataque' } },
        { 'x-response-id': RESP_ID, 'x-partial-token': signPartialToken(NEW_ID) }
      )
    )
    expect(res.status).toBe(201)
    expect(state.calls.some(c => c.table === 'responses' && c.op === 'update')).toBe(false)
  })

  it('aceita token via body (fallback do sendBeacon)', async () => {
    state.existingResponse = {
      data: { id: RESP_ID, sheets_row_index: null, form_id: FORM_ID, completed: false },
      error: null,
    }
    const res = await POST(
      makeReq({
        form_id: FORM_ID,
        answers: { q1: 'Beacon' },
        response_id: RESP_ID,
        partial_token: signPartialToken(RESP_ID),
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.response_id).toBe(RESP_ID)
  })

  it('parcial já finalizada não regride (skipped: already_completed)', async () => {
    state.existingResponse = {
      data: { id: RESP_ID, sheets_row_index: null, form_id: FORM_ID, completed: true },
      error: null,
    }
    const res = await POST(
      makeReq(
        { form_id: FORM_ID, answers: { q1: 'Tarde demais' } },
        { 'x-response-id': RESP_ID, 'x-partial-token': signPartialToken(RESP_ID) }
      )
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.skipped).toBe('already_completed')
    expect(state.calls.some(c => c.table === 'responses' && c.op === 'update')).toBe(false)
  })

  it('form não publicado → 404', async () => {
    state.form = { data: null, error: { message: 'not found' } }
    const res = await POST(makeReq({ form_id: FORM_ID, answers: { q1: 'x' } }))
    expect(res.status).toBe(404)
  })

  it('form_id fora do formato UUID → 400', async () => {
    const res = await POST(makeReq({ form_id: 'não-uuid', answers: { q1: 'x' } }))
    expect(res.status).toBe(400)
  })

  it('payload acima de 50KB → 413', async () => {
    const res = await POST(makeReq({ form_id: FORM_ID, answers: { q1: 'a'.repeat(60 * 1024) } }))
    expect(res.status).toBe(413)
  })

  it('respostas órfãs (pergunta deletada) não criam row — skipped', async () => {
    const res = await POST(makeReq({ form_id: FORM_ID, answers: { fantasma: 'x' } }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.skipped).toBe(true)
    expect(state.calls.some(c => c.table === 'responses' && c.op === 'insert')).toBe(false)
  })

  it('pergunta premium bloqueada pelo plano é podada em POST direto', async () => {
    state.form = {
      data: {
        ...formRow,
        questions: [{ id: 'doc', type: 'cpf', title: 'CPF/CNPJ' }],
      },
      error: null,
    }

    const res = await POST(makeReq({ form_id: FORM_ID, answers: { doc: '11.222.333/0001-81' } }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.skipped).toBe(true)
    expect(state.calls.some(c => c.table === 'responses' && c.op === 'insert')).toBe(false)
  })

  // ── Session key + idempotência (fix duplicatas 2026-07-08) ──────────────────

  it('criação com session key persiste o HASH (nunca a key crua) no INSERT', async () => {
    const res = await POST(
      makeReq({ form_id: FORM_ID, answers: { q1: 'Sidney' } }, { 'x-partial-session': SESSION_KEY })
    )
    expect(res.status).toBe(201)
    const insert = state.calls.find(c => c.table === 'responses' && c.op === 'insert')
    const payload = insert?.payload as Record<string, unknown>
    expect(payload.partial_session_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(payload)).not.toContain(SESSION_KEY)
  })

  it('session key INVÁLIDA é ignorada (vira fluxo legado, sem hash)', async () => {
    const res = await POST(
      makeReq({ form_id: FORM_ID, answers: { q1: 'x' } }, { 'x-partial-session': 'lixo!!' })
    )
    expect(res.status).toBe(201)
    const insert = state.calls.find(c => c.table === 'responses' && c.op === 'insert')
    expect((insert?.payload as Record<string, unknown>).partial_session_hash).toBeUndefined()
  })

  it('BEACON cria a row; fetch/save posterior SEM id+token adota via session key', async () => {
    // row já existe pra esta session (criada pelo beacon)
    state.existingResponse = {
      data: { id: RESP_ID, sheets_row_index: null, form_id: FORM_ID, completed: false, partial_revision: 1 },
      error: null,
    }
    const res = await POST(
      makeReq(
        { form_id: FORM_ID, answers: { q1: 'Continuando' }, partial_revision: 2 },
        { 'x-partial-session': SESSION_KEY }
      )
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.response_id).toBe(RESP_ID) // MESMA row — sem duplicata
    expect(state.calls.some(c => c.table === 'responses' && c.op === 'update')).toBe(true)
    expect(state.calls.some(c => c.table === 'responses' && c.op === 'insert')).toBe(false)
  })

  it('BEACON ATRASADO PÓS-SUBMIT: session aponta pra row completada → already_completed, NADA criado', async () => {
    state.existingResponse = {
      data: { id: RESP_ID, sheets_row_index: 5, form_id: FORM_ID, completed: true },
      error: null,
    }
    const res = await POST(
      makeReq({ form_id: FORM_ID, answers: { q1: 'atrasado' }, partial_session: SESSION_KEY })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.skipped).toBe('already_completed')
    expect(state.calls.some(c => c.table === 'responses' && c.op === 'insert')).toBe(false)
    expect(state.calls.some(c => c.table === 'responses' && c.op === 'update')).toBe(false)
  })

  it('CORRIDA fetch×beacon: INSERT perde no índice único (23505) → re-resolve e ADOTA', async () => {
    // 1º select por session não acha (a outra requisição ainda não commitou)...
    state.selectQueue = [{ data: null, error: null }]
    // ...o INSERT toma 23505...
    state.insertResult = { data: null, error: { code: '23505' } }
    // ...e o re-select (dentro do catch do insert) acha a row vencedora:
    state.existingResponse = {
      data: { id: RESP_ID, sheets_row_index: null, form_id: FORM_ID, completed: false, partial_revision: null },
      error: null,
    }
    const res = await POST(
      makeReq(
        { form_id: FORM_ID, answers: { q1: 'corrida' }, partial_revision: 1 },
        { 'x-partial-session': SESSION_KEY }
      )
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.response_id).toBe(RESP_ID) // adotou a vencedora — sem duplicata
    expect(state.calls.some(c => c.table === 'responses' && c.op === 'update')).toBe(true)
  })

  it('ORDEM INVERTIDA: revisão obsoleta não grava nem toca no Sheets (stale_or_completed)', async () => {
    state.form = { data: { ...formRow, google_sheets_enabled: true, google_sheets_id: 'sheet-1' }, error: null }
    // beacon rev2 já gravado; handshake rev1 chega DEPOIS
    state.existingResponse = {
      data: { id: RESP_ID, sheets_row_index: 7, form_id: FORM_ID, completed: false, partial_revision: 2 },
      error: null,
    }
    state.updateResult = { data: [], error: null } // o filtro de revisão não casa nenhuma linha
    const res = await POST(
      makeReq(
        { form_id: FORM_ID, answers: { q1: 'velho' }, partial_revision: 1 },
        { 'x-partial-session': SESSION_KEY }
      )
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.skipped).toBe('stale_or_completed')
    expect(vi.mocked(upsertSubmission)).not.toHaveBeenCalled() // Sheets intocado
  })

  it('defer_sheets NA CRIAÇÃO pula o Sheets; update posterior IGNORA o parâmetro', async () => {
    state.form = { data: { ...formRow, google_sheets_enabled: true, google_sheets_id: 'sheet-1' }, error: null }
    // criação com defer: nada de Sheets
    const res1 = await POST(
      makeReq(
        { form_id: FORM_ID, answers: { q1: 'handshake' }, defer_sheets: true, partial_revision: 1 },
        { 'x-partial-session': SESSION_KEY }
      )
    )
    expect(res1.status).toBe(201)
    expect(vi.mocked(upsertSubmission)).not.toHaveBeenCalled()

    // update com defer_sheets: parâmetro ignorado — Sheets sincroniza
    state.existingResponse = {
      data: { id: NEW_ID, sheets_row_index: null, form_id: FORM_ID, completed: false, partial_revision: 1 },
      error: null,
    }
    const res2 = await POST(
      makeReq(
        { form_id: FORM_ID, answers: { q1: 'update' }, defer_sheets: true, partial_revision: 2 },
        { 'x-partial-session': SESSION_KEY, 'x-response-id': NEW_ID, 'x-partial-token': signPartialToken(NEW_ID) }
      )
    )
    expect(res2.status).toBe(200)
    expect(vi.mocked(upsertSubmission)).toHaveBeenCalledTimes(1)
  })
})
