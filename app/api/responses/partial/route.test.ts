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
  calls: Array<{ table: string; op: string; payload?: unknown }>
} = {
  form: { data: null, error: null },
  existingResponse: { data: null, error: null },
  insertResult: { data: null, error: null },
  calls: [],
}

function makeBuilder(table: string) {
  const b: Record<string, unknown> & { _op: string; _payload?: unknown } = { _op: 'select' }
  const chain = () => b
  b.select = chain
  b.eq = chain
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
    if (table === 'responses' && b._op === 'select') res = state.existingResponse
    if (table === 'responses' && b._op === 'insert') res = state.insertResult
    if (table === 'responses' && b._op === 'update') res = { error: null }
    return Promise.resolve(res).then(resolve)
  }
  return b
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: (t: string) => makeBuilder(t) }),
}))
vi.mock('@/lib/response-rate-limit', () => ({
  checkResponseRateLimitAsync: vi.fn(async () => ({ allowed: true, remaining: 9, resetIn: 0 })),
}))
vi.mock('@/lib/google-sheets', () => ({ upsertSubmission: vi.fn(async () => ({ rowIndex: null })) }))
vi.mock('@/lib/logger', () => ({ logError: vi.fn(), logWarn: vi.fn(), log: vi.fn() }))

import { POST } from './route'

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
  state.calls = []
})

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
})
