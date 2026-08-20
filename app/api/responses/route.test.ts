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

const fakeClient = {
  from: (t: string) => makeBuilder(t),
  // Simula `promover_resposta_e_enfileirar_capi` com a MESMA semântica observável: promove se a
  // resposta-alvo existe com completed=false (CAS) e devolve o pacote que a rota consome. Os
  // testes de contrato do POST olham `calls` — a promoção continua registrada como update.
  rpc: (fn: string, args: Record<string, unknown>) => ({
    then: (resolve: (r: Result) => unknown) => {
      state.calls.push({ table: 'responses', op: 'update', payload: args })
      if (fn !== 'promover_resposta_e_enfileirar_capi') {
        return Promise.resolve({ data: null, error: { message: `rpc desconhecida: ${fn}` } }).then(resolve)
      }
      const existing = state.existingResponse.data as { id: string; completed?: boolean } | null
      const inserted = state.insertResult.data as { id: string } | null
      const target = existing ?? inserted
      const promovida = Boolean(target) && existing?.completed !== true
      const data = promovida
        ? {
            promovida: true,
            responseId: args.p_response_id,
            submittedAt: SUBMITTED_AT,
            sheetsRowIndex: null,
            metaEvents: (args.p_meta_events as string[]) ?? [],
            browserEvents: [],
          }
        : { promovida: false, responseId: args.p_response_id, browserEvents: [] }
      return Promise.resolve({ data, error: null } as Result).then(resolve)
    },
  }),
}
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
  extractPIIFromAnswers: vi.fn(() => ({})),
  codigoDeTesteValido: vi.fn(() => null),
}))
vi.mock('@/lib/capi-worker', () => ({ processarFila: vi.fn(async () => ({})) }))
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

  // L2-3 (auditoria 2026-08): a identidade passou a vir do TOKEN, nunca do corpo. Antes, mandar
  // o UUID da vítima em `respondent_id` bastava para ser tratado como dono da linha — e finalizar
  // resposta alheia disparava e-mail, WhatsApp, Sheets, webhook e CAPI com dados adulterados.
  //
  // O teste antigo exigia 403. Agora DEGRADA para resposta nova, de propósito: o player não tem
  // retry, e 403 no envio faz o respondente PERDER tudo que preencheu. Degradar é igualmente
  // seguro (a linha da vítima continua intocada) e não custa o lead.
  it('L2-3: sem token válido NÃO atualiza linha alheia — degrada para resposta nova', async () => {
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
    // O que importa para a segurança: a linha da vítima NÃO foi tocada.
    expect(state.calls.some(c => c.table === 'responses' && c.op === 'update')).toBe(false)
    // E o que importa para o negócio: a resposta de quem preencheu não se perdeu.
    expect(res.status).toBe(201)
    expect(state.calls.some(c => c.table === 'responses' && c.op === 'insert')).toBe(true)
  })

  // L2-3: o UPDATE de linha autenticada agora exige PROVA (Bearer), não o uid no corpo.
  it('L2-3: com token do dono, atualiza a própria linha normalmente', async () => {
    const { getRequestUser } = await import('@/lib/supabase/request-auth')
    vi.mocked(getRequestUser).mockResolvedValueOnce({ id: 'dono-real' } as never)
    state.existingResponse = {
      data: { id: RESP_ID, respondent_id: 'dono-real', completed: false, sheets_row_index: null },
      error: null,
    }
    const res = await POST(
      makeReq({ form_id: FORM_ID, answers: { q1: 'x' } }, { 'x-response-id': RESP_ID })
    )
    expect(res.status).toBe(200)
    expect(state.calls.some(c => c.table === 'responses' && c.op === 'update')).toBe(true)
  })

  // Bundle ANTIGO em cache: sem header, mas com o uid certo no corpo, e a linha JÁ completa.
  // Não pode virar resposta duplicada — isso geraria lead, e-mail e linha de Sheets em dobro.
  // Escrever exige token; este curto-circuito não escreve nada, então aceita o sinal legado.
  it('L2-3: reenvio de bundle antigo em linha já completa responde already_completed, sem duplicar', async () => {
    state.existingResponse = {
      data: { id: RESP_ID, respondent_id: 'dono-real', completed: true, sheets_row_index: null },
      error: null,
    }
    const res = await POST(
      makeReq(
        { form_id: FORM_ID, answers: { q1: 'x' }, respondent_id: 'dono-real' },
        { 'x-response-id': RESP_ID }
      )
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ already_completed: true })
    expect(state.calls.some(c => c.table === 'responses' && c.op === 'insert')).toBe(false)
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

/**
 * A CASCATA do `sanitizeValue` (auditoria 2026-08, lote 5).
 *
 * O teste de unidade em `lib/form-response-security.test.ts` prova que a função parou de destruir
 * `<joao@empresa.com>`. Ele NÃO prova o que importa para o negócio: que a resposta volta a contar
 * como COMPLETA. E `completed` é o portão único de e-mail ao dono, WhatsApp, Google Sheets, pixel
 * da Meta e webhook do cliente — com ele em `false`, nada dispara e o lead deixa de existir.
 *
 * Por isso a asserção é sobre o CORPO DA RESPOSTA HTTP, e não sobre espião de mock: espião prova
 * que uma função foi chamada; o corpo prova o que o sistema realmente decidiu. Já houve registro
 * interno de mock desta cadeia dando "falso conforto"
 * (`docs/briefing-auditoria-pre-venda-2026-07-29.md`, A-5).
 */
describe('POST /api/responses — cascata do sanitizeValue (lote 5)', () => {
  it('e-mail entre <> em campo OBRIGATÓRIO mantém a resposta COMPLETA', async () => {
    // Antes: `<joao@empresa.com>` virava '' → obrigatória vazia → completed=false → nenhum
    // disparo → o dono nunca soube do lead, e o respondente viu tela de sucesso.
    const res = await POST(makeReq({
      form_id: FORM_ID,
      answers: { q1: 'João', 'q-req': '<joao@empresa.com>' },
    }))
    const body = await res.json()
    expect(res.status).toBeLessThan(300)
    expect(body.completed, 'a resposta voltou a ser marcada como incompleta').toBe(true)
  })

  it('comparação numérica em campo obrigatório também sobrevive', async () => {
    const res = await POST(makeReq({
      form_id: FORM_ID,
      answers: { q1: 'João', 'q-req': 'ganho < 5k e gasto > 2k' },
    }))
    expect((await res.json()).completed).toBe(true)
  })

  it('REGRESSÃO: tag de verdade continua sendo removida, e aí a obrigatória fica vazia', async () => {
    // O outro lado da moeda: apertar a regra não pode passar a aceitar `<script>` como resposta
    // válida. Aqui a limpeza esvazia o campo — e a resposta corretamente NÃO completa.
    const res = await POST(makeReq({
      form_id: FORM_ID,
      answers: { q1: 'João', 'q-req': '<img src=x onerror=alert(1)>' },
    }))
    expect((await res.json()).completed).toBe(false)
  })
})
