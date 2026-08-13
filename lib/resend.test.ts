import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sanitizeSubject, SUBJECT_MAX_CHARS, sendDunningEmail, sendLeadNotificationEmail } from './resend'

vi.mock('@/lib/logger', () => ({ log: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }))

describe('sanitizeSubject', () => {
  it('CR/LF viram espaço — injeção de cabeçalho não sobrevive', () => {
    const s = sanitizeSubject('Novo lead: Maria\r\nBcc: espiao@x.com')
    expect(s).not.toContain('\r')
    expect(s).not.toContain('\n')
    // e o e-mail que sobrou vira máscara de PII
    expect(s).toContain('***')
  })

  it('outros caracteres de controle também viram espaço', () => {
    expect(sanitizeSubject('Novo\tlead\u0000aqui')).toBe('Novo lead aqui')
  })

  it('caracteres invisíveis de formatação são REMOVIDOS (não viram espaço)', () => {
    expect(sanitizeSubject('Ma​ria')).toBe('Maria')
  })

  it('PII segue mascarada: CPF, e-mail e telefone', () => {
    expect(sanitizeSubject('CPF 123.456.789-00')).toBe('CPF ***')
    expect(sanitizeSubject('contato maria@exemplo.com')).toBe('contato ***')
    expect(sanitizeSubject('tel (83) 99999-8888')).toContain('***')
  })

  it('a limpeza roda ANTES da máscara — PII partida por controle não escapa', () => {
    // Com a ordem invertida, o "\r" no meio quebraria o padrão de CPF.
    expect(sanitizeSubject('CPF 123.456.789-00\r ok')).toBe('CPF *** ok')
  })

  it(`trunca em ${SUBJECT_MAX_CHARS} caracteres (era 50, que decepava assunto útil)`, () => {
    const s = sanitizeSubject('N'.repeat(200))
    expect(s.length).toBe(SUBJECT_MAX_CHARS)
    expect(s.endsWith('...')).toBe(true)
  })

  it('assunto curto passa intacto', () => {
    expect(sanitizeSubject('Novo lead: Maria — Psicoterapia')).toBe('Novo lead: Maria — Psicoterapia')
  })
})

describe('sendLeadNotificationEmail — política de retry', () => {
  const payload = { to: 'dono@clinica.com', subject: 'Novo lead: Maria', html: '<p>oi</p>', text: 'oi' }

  beforeEach(() => {
    process.env.RESEND_API_KEY = 'test-key'
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /** Resolve a promise deixando os `setTimeout` de backoff correrem. */
  async function run<T>(p: Promise<T>): Promise<T> {
    await vi.runAllTimersAsync()
    return p
  }

  /** Os args do fetch mockado — `vi.fn()` sem parâmetros declarados tipa
   *  `calls` como tupla vazia, e indexar [1] não compila. */
  const argsOf = (m: { mock: { calls: unknown[][] } }, i = 0) =>
    m.mock.calls[i] as unknown as [string, RequestInit & { body: string; headers: Record<string, string> }]

  it('4xx permanente NÃO repete — devolve na primeira tentativa', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 422, json: async () => ({ message: 'invalid' }) }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await run(sendLeadNotificationEmail(payload))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res).toEqual({ error: 'HTTP 422' })
  })

  it('5xx repete até o teto de 3 tentativas', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await run(sendLeadNotificationEmail(payload))

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(res).toEqual({ error: 'HTTP 500' })
  })

  it('429 (rate limit) repete e o sucesso na 2ª tentativa vale', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'msg-1' }) })
    vi.stubGlobal('fetch', fetchMock)

    const res = await run(sendLeadNotificationEmail(payload))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(res).toEqual({ id: 'msg-1' })
  })

  it('408 também é repetível', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 408, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)
    await run(sendLeadNotificationEmail(payload))
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('timeout aborta a tentativa, repete, e é reportado como timeout', async () => {
    const fetchMock = vi.fn(async () => {
      const err = new Error('The operation was aborted due to timeout')
      err.name = 'TimeoutError'
      throw err
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await run(sendLeadNotificationEmail(payload))

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(res).toEqual({ error: 'timeout' })
  })

  it('todo fetch leva um AbortSignal (sem isso o envio podia pendurar a execução)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'x' }) }))
    vi.stubGlobal('fetch', fetchMock)

    await run(sendLeadNotificationEmail(payload))

    const [, init] = argsOf(fetchMock)
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('corpo não-JSON (proxy devolvendo HTML) não derruba o envio', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => { throw new SyntaxError('Unexpected token <') },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await run(sendLeadNotificationEmail(payload))
    expect(res).toEqual({ error: 'HTTP 502' })
  })

  it('manda html E texto puro no mesmo payload, com Idempotency-Key', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'x' }) }))
    vi.stubGlobal('fetch', fetchMock)

    await run(sendLeadNotificationEmail({ ...payload, idempotencyKey: 'chave-123' }))

    const [, init] = argsOf(fetchMock)
    const body = JSON.parse(init.body)
    expect(body.html).toBe('<p>oi</p>')
    expect(body.text).toBe('oi')
    expect(init.headers['Idempotency-Key']).toBe('chave-123')
  })

  it('sem RESEND_API_KEY não finge que enviou', async () => {
    delete process.env.RESEND_API_KEY
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await run(sendLeadNotificationEmail(payload))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(res.error).toBe('RESEND_API_KEY not configured')
  })
})

describe('sendLeadNotificationEmail — logs sem PII', () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = 'test-key'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('não registra o assunto (carrega o nome do lead) nem o endereço em claro', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'x' }) })))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await sendLeadNotificationEmail({
      to: 'paciente@gmail.com',
      subject: 'Novo lead: Maria Fernanda — Psicoterapia',
      html: '<p>x</p>',
    })

    const logged = JSON.stringify(logSpy.mock.calls)
    expect(logged).not.toContain('Maria Fernanda')
    expect(logged).not.toContain('paciente@gmail.com')
    // o domínio fica: dá pra depurar entrega sem identificar a pessoa
    expect(logged).toContain('@gmail.com')
  })
})

describe('sendDunningEmail — idempotência da outbox', () => {
  it('repassa a chave estável como Idempotency-Key', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'email-1' }) }))
    vi.stubGlobal('fetch', fetchMock)

    await sendDunningEmail({
      to: 'cliente@exemplo.com', assunto: 'Pagamento pendente', paragrafos: ['Olá'],
      ctaLabel: 'Regularizar', ctaUrl: 'https://eidosform.com.br/pagar/token',
      idempotencyKey: 'dunning:p1:0:2026-08-13:email',
    })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }]
    expect(init.headers['Idempotency-Key']).toBe('dunning:p1:0:2026-08-13:email')
    vi.unstubAllGlobals()
  })
})
