import { describe, it, expect, vi, beforeEach } from 'vitest'
import { signPartialToken } from '@/lib/partial-token'

// Contrato do submit final (/api/responses) pós-A1:
//  - upgrade parcial→final anônimo exige partial_token
//  - sem token: degrada para INSERT novo (lead não se perde, vítima não é sobrescrita)
//  - respondent_id errado em row autenticada → 403
//  - honeypot, limites e validações continuam intactos

/** Horário PERSISTIDO devolvido pelo banco — o e-mail tem que usar ESTE. */
const SUBMITTED_AT = '2026-07-30T17:32:10.000Z'

type Result = { data?: unknown; error?: unknown }
const state: {
  form: Result
  profile: Result
  existingResponse: Result
  insertResult: Result
  calls: Array<{ table: string; op: string; payload?: unknown }>
} = {
  form: { data: null, error: null },
  profile: { data: null, error: null },
  existingResponse: { data: null, error: null },
  insertResult: { data: null, error: null },
  calls: [],
}

function makeBuilder(table: string) {
  const b: Record<string, unknown> & { _op: string; _payload?: unknown } = { _op: 'select' }
  const chain = () => b
  b.select = chain
  b.eq = chain
  b.in = chain
  b.order = chain
  b.range = chain
  b.single = chain
  b.maybeSingle = chain
  b.insert = (p: unknown) => { b._op = 'insert'; b._payload = p; return b }
  b.update = (p: unknown) => { b._op = 'update'; b._payload = p; return b }
  b.delete = () => { b._op = 'delete'; return b }
  b.then = (resolve: (r: Result) => unknown) => {
    state.calls.push({ table, op: b._op, payload: b._payload })
    let res: Result = { data: null, error: null }
    if (table === 'forms' && b._op === 'select') res = state.form
    if (table === 'profiles' && b._op === 'select') res = state.profile
    if (table === 'responses' && b._op === 'select') res = state.existingResponse
    if (table === 'responses' && b._op === 'insert') res = state.insertResult
    if (table === 'responses' && b._op === 'update') {
      // .update().eq().eq().select('id, ...').single() → devolve a própria row
      const existing = state.existingResponse.data as { id: string } | null
      const inserted = state.insertResult.data as { id: string } | null
      const target = existing ?? inserted
      res = { data: target ? { id: target.id, meta_events: [], sheets_row_index: null, submitted_at: SUBMITTED_AT } : null, error: null }
    }
    return Promise.resolve(res).then(resolve)
  }
  return b
}

const fakeClient = { from: (t: string) => makeBuilder(t) }
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleClient: () => fakeClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeClient }))
vi.mock('@/lib/supabase/request-auth', () => ({ getRequestUser: vi.fn(async () => null) }))
vi.mock('@/lib/plan-limits', async () => ({
  // PLANS REAL: o gate de notificação por e-mail é `PLANS[plano].emailNotifications`.
  // Com o stub `{}` de antes, nenhum teste da rota conseguia entrar no bloco de
  // e-mail — o gate ficava sempre falso e a cobertura era ilusória.
  PLANS: (await vi.importActual<typeof import('@/lib/plan-definitions')>('@/lib/plan-definitions')).PLANS,
  checkAndIncrementResponseCount: vi.fn(async () => ({
    allowed: true,
    usage: 1,
    plan: 'professional',
    limit: 15000,
    nearLimit: false,
    alreadyCounted: false,
    unavailable: false,
  })),
}))
vi.mock('@/lib/response-rate-limit', () => ({
  checkResponseRateLimitAsync: vi.fn(async () => ({ allowed: true, remaining: 9, resetIn: 0 })),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimitAsync: vi.fn(async () => ({ allowed: true, remaining: 59, resetIn: 0 })),
}))
vi.mock('@/lib/webhook-dispatcher', () => ({ dispatchWebhook: vi.fn(async () => undefined) }))
vi.mock('@/lib/notification-email', async (importOriginal) => {
  // resolveEmailRecipients é PURA (normaliza e deduplica) — o teste usa a real
  // e só finge o envio, senão a dedup de destinatário ficaria sem cobertura.
  const actual = await importOriginal<typeof import('@/lib/notification-email')>()
  return { ...actual, sendNewResponseEmails: vi.fn(async () => []) }
})
vi.mock('@/lib/integration-stubs', () => ({ sendWhatsAppOnFormResponse: vi.fn(async () => undefined) }))
vi.mock('@/lib/google-sheets', () => ({ upsertSubmission: vi.fn(async () => ({ rowIndex: null })) }))
vi.mock('@/lib/meta-capi', () => ({
  sendMetaCAPIEvent: vi.fn(async () => true),
  extractPIIFromAnswers: vi.fn(() => ({})),
}))
vi.mock('@/lib/resend', () => ({ sendLeadNotificationEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/logger', () => ({ logError: vi.fn(), logWarn: vi.fn(), log: vi.fn() }))

import { POST } from './route'

const FORM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const RESP_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const NEW_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

// Pergunta required NÃO respondida nos testes → completed=false → pula o bloco
// de integrações pós-submit (fora do escopo deste contrato).
const formRow = {
  id: FORM_ID,
  title: 'Form de teste',
  user_id: 'owner-1',
  status: 'published',
  is_closed: false,
  paused: false,
  webhook_url: null,
  notify_email_enabled: false,
  notify_email: null,
  google_sheets_enabled: false,
  google_sheets_id: null,
  questions: [
    { id: 'q1', type: 'short_text', title: 'Nome' },
    { id: 'q-req', type: 'short_text', title: 'Obrigatória', required: true },
  ],
}

function makeReq(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest
}

beforeEach(() => {
  process.env.PARTIAL_TOKEN_SECRET = 'test-secret'
  state.form = { data: formRow, error: null }
  state.profile = { data: { plan: 'professional', email: null, plan_expires_at: null }, error: null }
  state.existingResponse = { data: null, error: null }
  state.insertResult = { data: { id: NEW_ID, meta_events: [], submitted_at: SUBMITTED_AT }, error: null }
  state.calls = []
  vi.clearAllMocks()
})

const anonRow = { id: RESP_ID, respondent_id: null, completed: false, sheets_row_index: null }

describe('POST /api/responses — upgrade parcial→final (A1)', () => {
  it('com partial_token válido: atualiza a parcial anônima (200, mesmo id)', async () => {
    state.existingResponse = { data: anonRow, error: null }
    const res = await POST(
      makeReq(
        { form_id: FORM_ID, answers: { q1: 'Sidney' } },
        { 'x-response-id': RESP_ID, 'x-partial-token': signPartialToken(RESP_ID) }
      )
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.response_id).toBe(RESP_ID)
    expect(state.calls.some(c => c.table === 'responses' && c.op === 'update')).toBe(true)
  })

  it('SEM token: cria resposta nova (201) e NÃO toca na parcial alheia', async () => {
    state.existingResponse = { data: anonRow, error: null }
    const res = await POST(
      makeReq({ form_id: FORM_ID, answers: { q1: 'Atacante' } }, { 'x-response-id': RESP_ID })
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.response_id).toBe(NEW_ID)
    expect(state.calls.some(c => c.table === 'responses' && c.op === 'update')).toBe(false)
  })

  it('token forjado: também degrada para INSERT novo', async () => {
    state.existingResponse = { data: anonRow, error: null }
    const res = await POST(
      makeReq(
        { form_id: FORM_ID, answers: { q1: 'Atacante' } },
        { 'x-response-id': RESP_ID, 'x-partial-token': 'deadbeef'.repeat(8) }
      )
    )
    expect(res.status).toBe(201)
    expect(state.calls.some(c => c.table === 'responses' && c.op === 'update')).toBe(false)
  })

  it('row AUTENTICADA com respondent_id divergente → 403 (não degrada)', async () => {
    state.existingResponse = {
      data: { id: RESP_ID, respondent_id: 'dono-real', completed: false, sheets_row_index: null },
      error: null,
    }
    const res = await POST(
      makeReq(
        { form_id: FORM_ID, answers: { q1: 'x' }, respondent_id: 'impostor' },
        { 'x-response-id': RESP_ID }
      )
    )
    expect(res.status).toBe(403)
    expect(state.calls.some(c => c.table === 'responses' && c.op === 'insert')).toBe(false)
  })

  it('row autenticada com respondent_id correto atualiza sem precisar de token', async () => {
    state.existingResponse = {
      data: { id: RESP_ID, respondent_id: 'dono-real', completed: false, sheets_row_index: null },
      error: null,
    }
    const res = await POST(
      makeReq(
        { form_id: FORM_ID, answers: { q1: 'x' }, respondent_id: 'dono-real' },
        { 'x-response-id': RESP_ID }
      )
    )
    expect(res.status).toBe(200)
  })

  it('x-response-id inexistente → 404', async () => {
    state.existingResponse = { data: null, error: null }
    const res = await POST(
      makeReq({ form_id: FORM_ID, answers: { q1: 'x' } }, { 'x-response-id': RESP_ID })
    )
    expect(res.status).toBe(404)
  })

  it('INSERT anônimo incompleto devolve partial_token (continuidade do upsert)', async () => {
    const res = await POST(makeReq({ form_id: FORM_ID, answers: { q1: 'só a primeira' } }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.completed).toBe(false)
    expect(body.partial_token).toBe(signPartialToken(NEW_ID))
  })

  it('finalização de parcial cobra exatamente pela response_id adotada', async () => {
    const { checkAndIncrementResponseCount } = await import('@/lib/plan-limits')
    state.existingResponse = { data: anonRow, error: null }
    const res = await POST(
      makeReq(
        { form_id: FORM_ID, answers: { q1: 'Sidney', 'q-req': 'ok' } },
        { 'x-response-id': RESP_ID, 'x-partial-token': signPartialToken(RESP_ID) }
      )
    )
    expect(res.status).toBe(200)
    expect(checkAndIncrementResponseCount).toHaveBeenCalledWith('owner-1', RESP_ID)
  })

  it('submit fresco completo cria a row antes e cobra pela nova response_id', async () => {
    const { checkAndIncrementResponseCount } = await import('@/lib/plan-limits')
    const res = await POST(makeReq({
      form_id: FORM_ID,
      answers: { q1: 'Sidney', 'q-req': 'ok' },
    }))
    expect(res.status).toBe(201)
    expect(checkAndIncrementResponseCount).toHaveBeenCalledWith('owner-1', NEW_ID)
  })
})

describe('POST /api/responses — defesas básicas', () => {
  it('honeypot preenchido: 201 fake sem INSERT', async () => {
    const res = await POST(makeReq({ form_id: FORM_ID, answers: { q1: 'bot' }, _hp_: 'gotcha' }))
    expect(res.status).toBe(201)
    expect(state.calls.some(c => c.op === 'insert')).toBe(false)
  })

  it('form_id ausente → 400; não-UUID → 400', async () => {
    expect((await POST(makeReq({ answers: { q1: 'x' } }))).status).toBe(400)
    expect((await POST(makeReq({ form_id: 'abc', answers: { q1: 'x' } }))).status).toBe(400)
  })

  it('form fechado → 403 com mensagem de fechado', async () => {
    state.form = { data: { ...formRow, is_closed: true }, error: null }
    const res = await POST(makeReq({ form_id: FORM_ID, answers: { q1: 'x', 'q-req': 'completa' } }))
    expect(res.status).toBe(403)
  })

  it('form pausado (downgrade) → 403', async () => {
    state.form = { data: { ...formRow, paused: true }, error: null }
    const res = await POST(makeReq({ form_id: FORM_ID, answers: { q1: 'x' } }))
    expect(res.status).toBe(403)
  })

  it('validação por tipo: email inválido → 422 com field_errors', async () => {
    state.form = {
      data: { ...formRow, questions: [{ id: 'e1', type: 'email', title: 'Email' }] },
      error: null,
    }
    const res = await POST(makeReq({ form_id: FORM_ID, answers: { e1: 'não-é-email' } }))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.field_errors?.[0]?.questionId).toBe('e1')
  })

  it('todas as chaves podadas (campo bloqueado pelo plano) → 422 sem insert nem consumir cota', async () => {
    const { checkAndIncrementResponseCount } = await import('@/lib/plan-limits')
    vi.mocked(checkAndIncrementResponseCount).mockClear()
    // Dono free; form só com campo CPF/CNPJ,
    // que é Starter+ e portanto filtrado para [] nos endpoints. POST direto não
    // pode queimar cota nem criar resposta vazia.
    state.form = {
      data: { ...formRow, questions: [{ id: 'doc', type: 'cpf', title: 'CPF/CNPJ' }] },
      error: null,
    }
    state.profile = { data: { plan: 'free', email: null, plan_expires_at: null }, error: null }
    const res = await POST(makeReq({ form_id: FORM_ID, answers: { doc: '11.222.333/0001-81' } }))
    expect(res.status).toBe(422)
    expect(state.calls.some(c => c.table === 'responses' && c.op === 'insert')).toBe(false)
    expect(checkAndIncrementResponseCount).not.toHaveBeenCalled()
  })

  it('limite do plano estourado → 429', async () => {
    const { checkAndIncrementResponseCount } = await import('@/lib/plan-limits')
    vi.mocked(checkAndIncrementResponseCount).mockResolvedValueOnce({
      allowed: false, plan: 'free', limit: 100,
    } as Awaited<ReturnType<typeof checkAndIncrementResponseCount>>)
    const res = await POST(makeReq({
      form_id: FORM_ID,
      answers: { q1: 'x', 'q-req': 'resposta completa' },
    }))
    expect(res.status).toBe(429)
  })

  it('falha da RPC de cota fecha em 503 e não promove a response', async () => {
    const { checkAndIncrementResponseCount } = await import('@/lib/plan-limits')
    vi.mocked(checkAndIncrementResponseCount).mockResolvedValueOnce({
      allowed: false,
      usage: 0,
      plan: 'free',
      limit: 0,
      nearLimit: false,
      alreadyCounted: false,
      unavailable: true,
    })
    const res = await POST(makeReq({
      form_id: FORM_ID,
      answers: { q1: 'x', 'q-req': 'resposta completa' },
    }))
    expect(res.status).toBe(503)
    expect(state.calls.some(c => c.table === 'responses' && c.op === 'update')).toBe(false)
  })

  it('erro ao ler perfil retorna 503 antes de podar ou persistir respostas', async () => {
    state.profile = { data: null, error: { message: 'db unavailable' } }
    const res = await POST(makeReq({ form_id: FORM_ID, answers: { q1: 'x' } }))
    expect(res.status).toBe(503)
    expect(state.calls.some(c => c.table === 'responses' && c.op === 'insert')).toBe(false)
  })
})

// Cobre a lacuna apontada em §4.7 do plano: até aqui NENHUM teste da rota
// exercitava o caminho dono + e-mail adicional, porque os casos acima usam de
// propósito respostas INCOMPLETAS para pular o pós-submit.
describe('POST /api/responses — notificação por e-mail (resposta completa)', () => {
  const respostaCompleta = { form_id: FORM_ID, answers: { q1: 'Maria', 'q-req': 'ok' } }

  async function outroEnvio() {
    const { sendNewResponseEmails } = await import('@/lib/notification-email')
    return vi.mocked(sendNewResponseEmails)
  }

  it('dono + e-mail adicional distintos: UM envio com os DOIS destinatários', async () => {
    state.profile = { data: { plan: 'professional', email: 'dono@clinica.com', plan_expires_at: null }, error: null }
    state.form = { data: { ...formRow, notify_email_enabled: true, notify_email: 'secretaria@clinica.com' }, error: null }

    await POST(makeReq(respostaCompleta))

    const send = await outroEnvio()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].recipients).toEqual([
      { email: 'dono@clinica.com', role: 'owner' },
      { email: 'secretaria@clinica.com', role: 'form_email' },
    ])
  })

  it('e-mail adicional IGUAL ao do dono a menos de caixa/espaço: UM destinatário só', async () => {
    state.profile = { data: { plan: 'professional', email: 'dono@clinica.com', plan_expires_at: null }, error: null }
    state.form = { data: { ...formRow, notify_email_enabled: true, notify_email: '  Dono@Clinica.COM ' }, error: null }

    await POST(makeReq(respostaCompleta))

    const send = await outroEnvio()
    expect(send.mock.calls[0][0].recipients).toEqual([{ email: 'dono@clinica.com', role: 'owner' }])
  })

  it('o modelo leva o horário PERSISTIDO da resposta, não o relógio do envio', async () => {
    state.profile = { data: { plan: 'professional', email: 'dono@clinica.com', plan_expires_at: null }, error: null }

    await POST(makeReq(respostaCompleta))

    const send = await outroEnvio()
    const model = send.mock.calls[0][0].model
    expect(model.response.eventAt).toBe(SUBMITTED_AT)
    expect(model.form.id).toBe(FORM_ID)
    expect(model.identity.firstName).toBe('Maria')
  })

  it('plano sem notificação por e-mail (Starter): ninguém é notificado', async () => {
    state.profile = { data: { plan: 'starter', email: 'dono@clinica.com', plan_expires_at: null }, error: null }
    state.form = { data: { ...formRow, notify_email_enabled: true, notify_email: 'secretaria@clinica.com' }, error: null }

    await POST(makeReq(respostaCompleta))

    expect(await outroEnvio()).not.toHaveBeenCalled()
  })

  it('resposta INCOMPLETA não dispara e-mail', async () => {
    state.profile = { data: { plan: 'professional', email: 'dono@clinica.com', plan_expires_at: null }, error: null }

    await POST(makeReq({ form_id: FORM_ID, answers: { q1: 'só a primeira' } }))

    expect(await outroEnvio()).not.toHaveBeenCalled()
  })
})
