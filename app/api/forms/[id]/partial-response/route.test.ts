/**
 * Autosave autenticado (Plus+): a rota que NÃO tinha teste nenhum.
 *
 * Dois defeitos da auditoria 2026-08 (lote 2) nasceram exatamente dessa ausência:
 *  · L2-2 — a rota nunca chamava `validateAllAnswers`, então `validateFileUpload` (que exige
 *    o prefixo do bucket `form-uploads`) nunca rodava. Com uma CONTA GRÁTIS dava para gravar
 *    um "anexo" apontando para o domínio do atacante no formulário de outro cliente; o painel
 *    do dono renderiza o chip com botão "Baixar" e leva o DONO ao site do atacante.
 *  · L2-4 — a rota gastava `resp:${ip}`, o balde do SUBMIT final, fazendo o autosave consumir
 *    o orçamento do próprio envio.
 *
 * As três rotas irmãs já validavam. Este arquivo trava as duas correções.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Result = { data?: unknown; error?: unknown }

const QID_FILE = 'q-file'
const QID_TEXT = 'q-text'
const FORM_ID = '11111111-1111-4111-8111-111111111111'
const OWNER_ID = '22222222-2222-4222-8222-222222222222'
const SUPA_URL = 'https://proj.supabase.co'

const state: {
  form: Result
  ownerProfile: Result
  existingResponse: Result
  insertResult: Result
  updateResult: Result
  calls: Array<{ table: string; op: string; payload?: unknown }>
} = {
  form: { data: null, error: null },
  ownerProfile: { data: { plan: 'plus', plan_expires_at: null }, error: null },
  existingResponse: { data: null, error: null },
  insertResult: { data: { id: 'resp-new' }, error: null },
  updateResult: { data: [{ id: 'resp-upd' }], error: null },
  calls: [],
}

function makeBuilder(table: string) {
  const b: Record<string, unknown> & { _op: string; _payload?: unknown } = { _op: 'select' }
  const chain = () => b
  b.select = chain; b.eq = chain; b.order = chain; b.limit = chain
  b.single = chain; b.maybeSingle = chain
  b.insert = (p: unknown) => { b._op = 'insert'; b._payload = p; return b }
  b.update = (p: unknown) => { b._op = 'update'; b._payload = p; return b }
  b.then = (resolve: (r: Result) => unknown) => {
    state.calls.push({ table, op: b._op, payload: b._payload })
    let res: Result = { data: null, error: null }
    if (table === 'forms' && b._op === 'select') res = state.form
    if (table === 'profiles' && b._op === 'select') res = state.ownerProfile
    if (table === 'responses' && b._op === 'select') res = state.existingResponse
    if (table === 'responses' && b._op === 'insert') res = state.insertResult
    if (table === 'responses' && b._op === 'update') res = state.updateResult
    return Promise.resolve(res).then(resolve)
  }
  return b
}

vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: () => ({ from: (t: string) => makeBuilder(t) }),
}))
vi.mock('@/lib/supabase/request-auth', () => ({
  getRequestUser: vi.fn(async () => ({ id: 'user-atacante' })),
}))
vi.mock('@/lib/response-rate-limit', () => ({
  checkPartialRateLimitAsync: vi.fn(async () => ({ allowed: true, remaining: 29, resetIn: 0 })),
  checkResponseRateLimitAsync: vi.fn(async () => ({ allowed: true, remaining: 9, resetIn: 0 })),
}))
vi.mock('@/lib/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }))

import { PUT } from './route'
import { checkPartialRateLimitAsync, checkResponseRateLimitAsync } from '@/lib/response-rate-limit'

function req(answers: Record<string, unknown>) {
  return new Request(`http://localhost/api/forms/${FORM_ID}/partial-response`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify({ answers, last_question_answered: QID_TEXT }),
  }) as unknown as Parameters<typeof PUT>[0]
}
const params = { params: Promise.resolve({ id: FORM_ID }) }

/** O que efetivamente foi gravado no banco. */
function gravado(): Record<string, unknown> | null {
  const w = state.calls.find((c) => c.table === 'responses' && (c.op === 'insert' || c.op === 'update'))
  return w ? ((w.payload as { answers?: Record<string, unknown> }).answers ?? null) : null
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPA_URL
  state.calls = []
  state.existingResponse = { data: null, error: null }
  state.ownerProfile = { data: { plan: 'plus', plan_expires_at: null }, error: null }
  state.form = {
    data: {
      id: FORM_ID, user_id: OWNER_ID, status: 'published', is_closed: false,
      questions: [
        { id: QID_TEXT, type: 'short_text', title: 'Nome', required: false },
        { id: QID_FILE, type: 'file_upload', title: 'Anexo', required: false },
      ],
    },
    error: null,
  }
})

describe('PUT /api/forms/[id]/partial-response', () => {
  it('L2-2: DESCARTA anexo cuja URL aponta para fora do bucket (phishing no painel do dono)', async () => {
    const res = await PUT(req({
      [QID_TEXT]: 'João',
      [QID_FILE]: { name: 'contrato.pdf', url: 'https://site-do-atacante.com/isca.pdf' },
    }), params)

    expect(res.status).toBe(200)
    const salvo = gravado()
    // O anexo malicioso NÃO pode chegar ao banco...
    expect(salvo).not.toHaveProperty(QID_FILE)
    // ...e a resposta legítima da mesma requisição tem que sobreviver (descarte é por CHAVE,
    // não rejeição da requisição inteira — o autosave é silencioso e não pode perder progresso).
    expect(salvo).toEqual({ [QID_TEXT]: 'João' })
  })

  it('L2-2: ACEITA anexo legítimo do bucket form-uploads', async () => {
    const url = `${SUPA_URL}/storage/v1/object/public/form-uploads/${OWNER_ID}/${FORM_ID}/arq.pdf`
    const res = await PUT(req({ [QID_FILE]: { name: 'arq.pdf', url } }), params)

    expect(res.status).toBe(200)
    expect(gravado()).toEqual({ [QID_FILE]: { name: 'arq.pdf', url } })
  })

  it('L2-2: se TUDO for inválido, não cria linha vazia — responde skipped', async () => {
    const res = await PUT(req({
      [QID_FILE]: { name: 'x.pdf', url: 'https://evil.example/x.pdf' },
    }), params)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ skipped: true })
    expect(state.calls.some((c) => c.table === 'responses' && c.op !== 'select')).toBe(false)
  })

  it('L2-4: usa o balde dos PARCIAIS, nunca o do submit final', async () => {
    await PUT(req({ [QID_TEXT]: 'ok' }), params)

    expect(vi.mocked(checkPartialRateLimitAsync)).toHaveBeenCalledWith('203.0.113.9', FORM_ID)
    expect(vi.mocked(checkResponseRateLimitAsync)).not.toHaveBeenCalled()
  })
})
