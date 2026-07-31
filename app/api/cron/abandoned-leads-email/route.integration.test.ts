import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Exercita o HANDLER INTEIRO do cron de abandono por e-mail contra um Supabase
 * falso. É aqui que moram os riscos que só aparecem em produção: corrida entre
 * dois runs, lease vencido, e o lead que retomou o formulário entre o SELECT e
 * o envio.
 */

type Row = Record<string, unknown>

const db: {
  profiles: Row[]
  forms: Row[]
  responses: Row[]
  claims: Row[]
  /** Código de erro forçado no próximo INSERT de claim, por papel. */
  insertErrorByRole: Record<string, string | undefined>
  /**
   * Campos aplicados SÓ na releitura da revalidação. É assim que a corrida
   * acontece de verdade: a varredura vê o lead abandonado e ele muda ANTES do
   * envio. Marcar `completed` na row de origem não testaria nada — ela nem
   * entraria na varredura (que filtra `completed = false`).
   */
  recheckOverride: Row
  ops: Array<{ table: string; op: string; payload?: unknown }>
} = {
  profiles: [], forms: [], responses: [], claims: [], insertErrorByRole: {}, recheckOverride: {}, ops: [],
}

const FORM_ID = 'f1'
const RESP_ID = 'r1'

function matches(row: Row, filters: Array<[string, unknown]>): boolean {
  return filters.every(([k, v]) => row[k] === v)
}

function makeBuilder(table: string) {
  const filters: Array<[string, unknown]> = []
  let op = 'select'
  let payload: unknown
  let ltFilter: [string, string] | null = null

  const b: Record<string, unknown> = {}
  b.select = () => b
  b.eq = (k: string, v: unknown) => { filters.push([k, v]); return b }
  b.in = (k: string, vs: unknown[]) => { filters.push([`__in__${k}`, vs]); return b }
  b.gte = () => b
  b.lt = (k: string, v: string) => { ltFilter = [k, v]; return b }
  b.order = () => b
  b.limit = () => b
  b.is = () => b
  b.insert = (p: Row) => { op = 'insert'; payload = p; return b }
  b.update = (p: Row) => { op = 'update'; payload = p; return b }
  b.delete = () => { op = 'delete'; return b }
  b.single = () => b
  b.maybeSingle = () => b

  const resolve = () => {
    db.ops.push({ table, op, payload })
    const eqFilters = filters.filter(([k]) => !k.startsWith('__in__')) as Array<[string, unknown]>
    const inFilters = filters.filter(([k]) => k.startsWith('__in__')) as Array<[string, unknown[]]>
    const inMatch = (row: Row) =>
      inFilters.every(([k, vs]) => (vs as unknown[]).includes(row[k.replace('__in__', '')]))

    if (table === 'profiles') return { data: db.profiles.filter(inMatch), error: null }
    if (table === 'forms') return { data: db.forms.filter(inMatch), error: null }

    if (table === 'responses') {
      const rows = db.responses.filter((r) => matches(r, eqFilters) && inMatch(r))
      // .maybeSingle() da revalidação
      if (eqFilters.some(([k]) => k === 'id')) {
        return { data: rows[0] ? { ...rows[0], ...db.recheckOverride } : null, error: null }
      }
      return { data: rows, error: null }
    }

    if (table === 'form_notification_logs') {
      if (op === 'insert') {
        const role = String((payload as Row).recipient_role)
        const forced = db.insertErrorByRole[role]
        if (forced) return { data: null, error: { code: forced } }
        const dup = db.claims.some(
          (c) => c.response_id === (payload as Row).response_id &&
                 c.event_type === (payload as Row).event_type &&
                 c.channel === (payload as Row).channel &&
                 c.recipient_role === role
        )
        if (dup) return { data: null, error: { code: '23505' } }
        db.claims.push({ ...(payload as Row) })
        return { data: null, error: null }
      }
      if (op === 'update') {
        const hit = db.claims.filter(
          (c) => matches(c, eqFilters) && (!ltFilter || String(c[ltFilter[0]]) < ltFilter[1])
        )
        for (const c of hit) Object.assign(c, payload as Row)
        return { data: hit.map(() => ({ id: 'x' })), error: null }
      }
      if (op === 'delete') {
        const keep = db.claims.filter((c) => !matches(c, eqFilters))
        const removed = db.claims.length - keep.length
        db.claims = keep
        return { data: Array(removed).fill({}), error: null }
      }
      return { data: db.claims.filter((c) => matches(c, eqFilters) && inMatch(c)), error: null }
    }
    return { data: null, error: null }
  }

  b.then = (res: (r: unknown) => unknown) => Promise.resolve(resolve()).then(res)
  return b
}

vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ from: (t: string) => makeBuilder(t) }) }))
vi.mock('@/lib/logger', () => ({ log: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }))

type SendArgs = { to: string; subject: string; html: string; text?: string; idempotencyKey?: string }
type SendResult = { id?: string; error?: string }
const sendMock = vi.fn<(p: SendArgs) => Promise<SendResult>>(async () => ({ id: 'msg-1' }))
vi.mock('@/lib/resend', () => ({ sendLeadNotificationEmail: (p: SendArgs) => sendMock(p) }))

import { GET } from './route'

function req() {
  return new Request('http://localhost/api/cron/abandoned-leads-email', {
    headers: { authorization: 'Bearer test-cron-secret' },
  }) as unknown as import('next/server').NextRequest
}

const HORA_ATRAS = new Date(Date.now() - 60 * 60_000).toISOString()

beforeEach(() => {
  process.env.CRON_SECRET = 'test-cron-secret'
  process.env.ABANDONED_LEAD_MINUTES = '30'
  process.env.NEXT_PUBLIC_APP_URL = 'https://eidosform.com.br'
  sendMock.mockClear()
  sendMock.mockImplementation(async () => ({ id: 'msg-1' }))
  db.ops = []
  db.insertErrorByRole = {}
  db.recheckOverride = {}
  db.claims = []
  db.profiles = [{ id: 'u1', email: 'dono@clinica.com', plan: 'plus', plan_expires_at: null }]
  db.forms = [{
    id: FORM_ID, title: 'Psicoterapia', user_id: 'u1',
    notify_email: 'secretaria@clinica.com', notify_email_enabled: true,
    questions: [{ id: 'q_nome', type: 'short_text', title: 'Qual seu nome?' }],
  }]
  db.responses = [{
    id: RESP_ID, form_id: FORM_ID, completed: false, last_activity_at: HORA_ATRAS,
    answers: { q_nome: 'Maria' }, url_params: null, meta_events: [],
    utm_source: null, utm_medium: null, utm_campaign: null, utm_term: null, utm_content: null,
  }]
})

describe('cron de abandono por e-mail — handler completo', () => {
  it('avisa os DOIS destinatários e fecha os dois claims como sent', async () => {
    const res = await GET(req())
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.enviados).toBe(2)
    expect(sendMock).toHaveBeenCalledTimes(2)
    expect(db.claims).toHaveLength(2)
    expect(db.claims.every((c) => c.status === 'sent')).toBe(true)
    expect(new Set(db.claims.map((c) => c.recipient_role))).toEqual(new Set(['owner', 'form_email']))
  })

  it('CORRIDA: claim já existente e fresco (23505) não reenvia àquele destinatário', async () => {
    // Outro run acabou de pegar o claim do dono.
    db.insertErrorByRole.owner = '23505'
    db.claims = [{
      response_id: RESP_ID, form_id: FORM_ID, event_type: 'abandoned', channel: 'email',
      recipient_role: 'owner', status: 'pending', created_at: new Date().toISOString(),
    }]

    const body = await (await GET(req())).json()

    // Só a secretária recebe; o dono é do outro run.
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(body.jaAvisados).toBeGreaterThanOrEqual(1)
  })

  it('LEASE: claim pendente VENCIDO é retomado e o alerta sai', async () => {
    db.insertErrorByRole.owner = '23505'
    db.claims = [{
      response_id: RESP_ID, form_id: FORM_ID, event_type: 'abandoned', channel: 'email',
      recipient_role: 'owner', status: 'pending',
      created_at: new Date(Date.now() - 30 * 60_000).toISOString(), // > LEASE_MS (10 min)
    }]

    const body = await (await GET(req())).json()

    expect(body.retomados).toBe(1)
    expect(sendMock).toHaveBeenCalledTimes(2)
  })

  it('REVALIDAÇÃO: lead que completou o formulário NÃO recebe "lead incompleto"', async () => {
    db.recheckOverride = { completed: true }

    const body = await (await GET(req())).json()

    expect(sendMock).not.toHaveBeenCalled()
    expect(body.revalidadosFora).toBe(1)
    // e os claims adquiridos foram LIBERADOS (não ficam suprimindo o lead)
    expect(db.claims).toHaveLength(0)
  })

  it('REVALIDAÇÃO: lead que voltou a mexer no formulário também não recebe', async () => {
    db.recheckOverride = { last_activity_at: new Date().toISOString() }

    const body = await (await GET(req())).json()

    expect(sendMock).not.toHaveBeenCalled()
    expect(body.revalidadosFora).toBe(1)
    expect(db.claims).toHaveLength(0)
  })

  it('GATE: dono Starter não recebe nada', async () => {
    db.profiles = [{ id: 'u1', email: 'dono@clinica.com', plan: 'starter', plan_expires_at: null }]
    const body = await (await GET(req())).json()
    expect(sendMock).not.toHaveBeenCalled()
    expect(body.enviados).toBe(0)
  })

  it('GATE: Plus VENCIDO não recebe (a coluna ainda diz plus)', async () => {
    db.profiles = [{
      id: 'u1', email: 'dono@clinica.com', plan: 'plus',
      plan_expires_at: new Date(Date.now() - 86_400_000).toISOString(),
    }]
    const body = await (await GET(req())).json()
    expect(sendMock).not.toHaveBeenCalled()
    expect(body.enviados).toBe(0)
  })

  it('lead SEM telefone recebe alerta normalmente (regressão do isActionable)', async () => {
    db.responses[0].answers = { q_nome: 'Maria' } // nenhum telefone
    await GET(req())
    expect(sendMock).toHaveBeenCalledTimes(2)
    const enviado = sendMock.mock.calls[0][0]
    expect(enviado.subject).toContain('Lead incompleto: Maria')
    expect(enviado.html).not.toContain('wa.me')
  })

  it('resposta em branco não vira alerta', async () => {
    db.responses[0].answers = { q_nome: '   ' }
    const body = await (await GET(req())).json()
    expect(sendMock).not.toHaveBeenCalled()
    expect(body.semConteudo).toBe(1)
  })

  it('falha de envio vira claim failed — e NÃO é retentada no run seguinte', async () => {
    sendMock.mockImplementation(async () => ({ error: 'HTTP 422' }))

    await GET(req())
    expect(db.claims.every((c) => c.status === 'failed')).toBe(true)

    sendMock.mockClear()
    sendMock.mockImplementation(async () => ({ id: 'msg-2' }))
    await GET(req())
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('run seguinte não reenvia o que já foi enviado (idempotência entre execuções)', async () => {
    await GET(req())
    expect(sendMock).toHaveBeenCalledTimes(2)
    sendMock.mockClear()
    await GET(req())
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('destinatário NOVO configurado depois recebe, sem reenviar para quem já recebeu', async () => {
    // 1º run: só o dono é destinatário.
    db.forms[0].notify_email_enabled = false
    await GET(req())
    expect(sendMock).toHaveBeenCalledTimes(1)

    // Dono liga o e-mail adicional e o cron roda de novo.
    db.forms[0].notify_email_enabled = true
    sendMock.mockClear()
    await GET(req())

    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0][0]).toMatchObject({ to: 'secretaria@clinica.com' })
  })

  it('sem CRON_SECRET correto → 401 e nenhum acesso ao banco', async () => {
    db.ops = []
    const res = await GET(new Request('http://localhost/x', {
      headers: { authorization: 'Bearer errado' },
    }) as unknown as import('next/server').NextRequest)
    expect(res.status).toBe(401)
    expect(db.ops).toHaveLength(0)
  })
})
