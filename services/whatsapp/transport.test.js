import { describe, it, expect, vi } from 'vitest'
import {
  ERROR_CLASS,
  alternateBrazilianPhone,
  formatBrazilianPhone,
  sendWithTransportFallback,
} from './transport.js'
import {
  classifyFetchError,
  classifyHttpFailure,
  createWuzapiTransport,
  safeMessageId,
} from './transport-wuzapi.js'
import { classifyWacliFailure, createWacliTransport } from './transport-wacli.js'

const deps = { log: vi.fn(), hashPhone: () => 'hash' }

function fakeTransport(name, results) {
  const queue = [...results]
  return {
    name,
    enviarTexto: vi.fn(async () => queue.shift()),
  }
}

describe('fallback entre transportes', () => {
  it('sucesso primário chama exatamente um motor', async () => {
    const primary = fakeTransport('wuzapi', [{ success: true, messageId: 'A' }])
    const fallback = fakeTransport('wacli', [{ success: true, messageId: 'B' }])
    const result = await sendWithTransportFallback({
      primary, fallback, phone: '5583999999999', message: 'x', ...deps,
    })
    expect(result).toEqual(expect.objectContaining({ success: true, transport: 'wuzapi', fallback: false }))
    expect(primary.enviarTexto).toHaveBeenCalledTimes(1)
    expect(fallback.enviarTexto).not.toHaveBeenCalled()
  })

  it('PRE_FLIGHT aciona o reserva somente depois da resposta do primário', async () => {
    const order = []
    const primary = {
      name: 'wuzapi',
      enviarTexto: vi.fn(async () => {
        order.push('primary')
        return { success: false, error: 'down', errorClass: ERROR_CLASS.PRE_FLIGHT }
      }),
    }
    const fallback = {
      name: 'wacli',
      enviarTexto: vi.fn(async () => {
        order.push('fallback')
        return { success: true, messageId: 'B' }
      }),
    }
    const onFallback = vi.fn(async () => order.push('alert'))
    const result = await sendWithTransportFallback({
      primary, fallback, phone: '5583999999999', message: 'x', onFallback, ...deps,
    })
    expect(order).toEqual(['primary', 'alert', 'fallback'])
    expect(result).toEqual(expect.objectContaining({ transport: 'wacli', fallback: true }))
  })

  it.each([ERROR_CLASS.IN_FLIGHT, ERROR_CLASS.PERMANENTE])(
    '%s nunca aciona outro motor',
    async (errorClass) => {
      const primary = fakeTransport('wuzapi', [{ success: false, error: 'x', errorClass }])
      const fallback = fakeTransport('wacli', [{ success: true, messageId: 'B' }])
      await sendWithTransportFallback({
        primary, fallback, phone: '5583999999999', message: 'x', ...deps,
      })
      expect(fallback.enviarTexto).not.toHaveBeenCalled()
    },
  )

  it('fallback vazio fica realmente desligado', async () => {
    const primary = fakeTransport('wuzapi', [{
      success: false, error: 'down', errorClass: ERROR_CLASS.PRE_FLIGHT,
    }])
    const result = await sendWithTransportFallback({
      primary, fallback: null, phone: '5583999999999', message: 'x', ...deps,
    })
    expect(result.success).toBe(false)
    expect(primary.enviarTexto).toHaveBeenCalledTimes(1)
  })
})

describe('fallback brasileiro 8/9 dígitos', () => {
  it('calcula as duas direções', () => {
    expect(alternateBrazilianPhone('5583999999999')).toBe('558399999999')
    expect(alternateBrazilianPhone('558399999999')).toBe('5583999999999')
  })

  it('não tenta variante depois de timeout ambíguo', async () => {
    const primary = fakeTransport('wuzapi', [{
      success: false, error: 'timeout', errorClass: ERROR_CLASS.IN_FLIGHT,
    }])
    await sendWithTransportFallback({
      primary, fallback: null, phone: '5583999999999', message: 'x', ...deps,
    })
    expect(primary.enviarTexto).toHaveBeenCalledTimes(1)
  })

  it('respeita a ordem específica do motor e tenta variante após rejeição inequívoca', async () => {
    const primary = fakeTransport('wacli', [
      {
        success: false,
        error: 'invalid',
        errorClass: ERROR_CLASS.PERMANENTE,
        retryAlternateNumber: true,
      },
      { success: true, messageId: 'OK' },
    ])
    primary.phoneCandidates = () => ['558399999999', '5583999999999']
    const result = await sendWithTransportFallback({
      primary, fallback: null, phone: '5583999999999', message: 'x', ...deps,
    })
    expect(result.success).toBe(true)
    expect(primary.enviarTexto.mock.calls.map((call) => call[0])).toEqual([
      '558399999999',
      '5583999999999',
    ])
  })
})

describe('ordem do número é IGUAL em todo motor', () => {
  // Regressão real (auditoria 2026-07-27): o wuzapi nasceu sem `phoneCandidates`
  // e caía no default antigo, que tentava 13 dígitos PRIMEIRO. Como um JID
  // inexistente recebe ACK do servidor em vez de erro, a virada de transporte
  // teria perdido notificações em silêncio — sem log de falha, sem retry.
  const motores = () => [
    ['wacli', createWacliTransport({ log: () => {}, hashPhone: () => 'hash' })],
    ['wuzapi', createWuzapiTransport({ token: 'secret', fetchFn: vi.fn() })],
  ]

  it.each(motores())('%s começa pela variante de 12 dígitos provada em produção', (_nome, transport) => {
    expect(transport.phoneCandidates('5583996966457')).toEqual([
      '558396966457',
      '5583996966457',
    ])
  })

  it('nenhum motor diverge do outro', () => {
    const ordens = motores().map(([, t]) => JSON.stringify(t.phoneCandidates('5583996966457')))
    expect(new Set(ordens).size).toBe(1)
  })

  it('o default de quem não declara nada já é a ordem certa', async () => {
    const primary = fakeTransport('novo-motor', [
      { success: false, error: 'invalid phone', errorClass: ERROR_CLASS.PERMANENTE, retryAlternateNumber: true },
      { success: true, messageId: 'OK' },
    ])
    await sendWithTransportFallback({
      primary, fallback: null, phone: '55 (83) 99696-6457', message: 'x', ...deps,
    })
    expect(primary.enviarTexto.mock.calls.map((call) => call[0])).toEqual([
      '558396966457',
      '5583996966457',
    ])
  })
})

describe('número exibido no painel', () => {
  it('os dois motores exibem a MESMA linha no MESMO formato', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { connected: true, loggedIn: true, jid: '558396966457:4@s.whatsapp.net' },
      }),
    })
    const wuzapi = createWuzapiTransport({ token: 'secret', fetchFn })
    expect((await wuzapi.obterStatus()).phone).toBe('+55 83 9696-6457')
    // Mesmo formato que o wacli produz a partir do jid do banco de sessão.
    expect(formatBrazilianPhone('558396966457')).toBe('+55 83 9696-6457')
  })

  it('não inventa formato para o que não é celular brasileiro', () => {
    expect(formatBrazilianPhone('')).toBe(null)
    expect(formatBrazilianPhone('12345')).toBe('12345')
  })
})

describe('conexão do WuzAPI — eventos assinados são ENTREGA, não enfeite', () => {
  const resposta = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
  // `jid` presente = PAREADO. Sem jid = nunca pareado. É essa a distinção que
  // o `loggedIn` sozinho não dá — ele cai junto com a conexão.
  const sessao = (connected, loggedIn = true, jid = '558396966457:4@s.whatsapp.net') =>
    resposta(200, { success: true, data: { connected, loggedIn, jid } })

  it('REGRESSÃO: conecta assinando eventos, nunca com lista vazia', async () => {
    // Com `Subscribe: []` o pedido de reenvio do aparelho cai no vazio e a
    // mensagem fica presa como "Aguardando mensagem" no celular — entregue
    // pelo servidor, ilegível para o humano. Aconteceu em produção 27/07.
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(sessao(false))                     // status: desconectado
      .mockResolvedValueOnce(resposta(200, { success: true }))  // connect
      .mockResolvedValueOnce(sessao(true))                      // status: reconectado
      .mockResolvedValueOnce(resposta(200, {
        success: true, data: { Details: 'Sent', Id: 'MSG', Timestamp: 1 },
      }))
    const transport = createWuzapiTransport({ token: 'secret', fetchFn })
    const r = await transport.enviarTexto('5583996966457', 'oi')

    expect(r.success).toBe(true)
    const connect = fetchFn.mock.calls.find((c) => String(c[0]).endsWith('/session/connect'))
    expect(connect).toBeDefined()
    const enviado = JSON.parse(connect[1].body).Subscribe
    expect(enviado.length).toBeGreaterThan(0)
    expect(enviado).toContain('Message')
  })

  it('pareado mas desconectado deixou de ser beco sem saída — reconecta sozinho', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(sessao(false))
      .mockResolvedValueOnce(resposta(200, { success: true }))
      .mockResolvedValueOnce(sessao(true))
      .mockResolvedValueOnce(resposta(200, {
        success: true, data: { Details: 'Sent', Id: 'MSG', Timestamp: 1 },
      }))
    const transport = createWuzapiTransport({ token: 'secret', fetchFn })
    expect((await transport.enviarTexto('5583996966457', 'oi')).success).toBe(true)
  })

  it('NÃO pareado (sem jid) não tenta reconectar — aí o caminho é QR, não retry', async () => {
    const fetchFn = vi.fn().mockResolvedValue(sessao(false, false, ''))
    const transport = createWuzapiTransport({ token: 'secret', fetchFn })
    const r = await transport.enviarTexto('5583996966457', 'oi')

    expect(r).toEqual(expect.objectContaining({
      success: false, errorClass: ERROR_CLASS.PRE_FLIGHT,
    }))
    expect(fetchFn.mock.calls.some((c) => String(c[0]).endsWith('/session/connect'))).toBe(false)
  })
})

describe('classificação de erro', () => {
  it('ECONNREFUSED é PRE_FLIGHT e timeout é IN_FLIGHT', () => {
    expect(classifyFetchError({ cause: { code: 'ECONNREFUSED' } }).errorClass).toBe(ERROR_CLASS.PRE_FLIGHT)
    expect(classifyFetchError({ name: 'TimeoutError' }).errorClass).toBe(ERROR_CLASS.IN_FLIGHT)
  })

  it('HTTP separa auth, payload e 5xx ambíguo', () => {
    expect(classifyHttpFailure(401, {}).errorClass).toBe(ERROR_CLASS.PRE_FLIGHT)
    expect(classifyHttpFailure(400, { error: 'could not parse Phone' })).toEqual(expect.objectContaining({
      errorClass: ERROR_CLASS.PERMANENTE,
      retryAlternateNumber: true,
    }))
    expect(classifyHttpFailure(500, { error: 'internal' }).errorClass).toBe(ERROR_CLASS.IN_FLIGHT)
    expect(classifyHttpFailure(500, { error: 'no session' }).errorClass).toBe(ERROR_CLASS.PRE_FLIGHT)
  })

  it('REGRESSÃO 29/07: erro 463 é RETENTÁVEL, não sentença de destinatário inválido', () => {
    // A classificação anterior (PERMANENTE) veio de generalizar UM experimento
    // e custou 3 notificações DESCARTADAS na hora, para números que existiam.
    // Tem que continuar liberando a outra variante do número (nada foi
    // entregue) SEM condenar a mensagem à carta morta.
    const r = classifyHttpFailure(500, {
      error: 'error sending message: server returned error 463',
    })
    expect(r.retryAlternateNumber).toBe(true)
    expect(r.errorClass).toBe(ERROR_CLASS.PRE_FLIGHT)
    expect(r.errorClass).not.toBe(ERROR_CLASS.PERMANENTE) // nunca mais
  })

  it('463 percorre a escada: outra variante -> motor reserva (em vez de morrer)', async () => {
    const primary = fakeTransport('wuzapi', [
      { success: false, error: 'wuzapi_rejeitado_463', errorClass: ERROR_CLASS.PRE_FLIGHT, retryAlternateNumber: true },
      { success: false, error: 'wuzapi_rejeitado_463', errorClass: ERROR_CLASS.PRE_FLIGHT, retryAlternateNumber: true },
    ])
    primary.phoneCandidates = () => ['558396966457', '5583996966457']
    const fallback = fakeTransport('wacli', [{ success: true, messageId: 'SALVO' }])

    const r = await sendWithTransportFallback({
      primary, fallback, phone: '5583996966457', message: 'x', ...deps,
    })
    // as DUAS variantes foram tentadas...
    expect(primary.enviarTexto).toHaveBeenCalledTimes(2)
    // ...e o reserva salvou a notificação em vez de ela virar carta morta
    expect(r).toEqual(expect.objectContaining({ success: true, transport: 'wacli', fallback: true }))
  })

  it('5xx genérico continua ambíguo e NÃO tenta outra variante', () => {
    const generico = classifyHttpFailure(500, { error: 'gateway blew up' })
    expect(generico.errorClass).toBe(ERROR_CLASS.IN_FLIGHT)
    expect(generico.retryAlternateNumber).toBeFalsy()
  })

  it('wacli também separa timeout, sessão e destinatário', () => {
    expect(classifyWacliFailure('wacli_timeout_or_killed').errorClass).toBe(ERROR_CLASS.IN_FLIGHT)
    expect(classifyWacliFailure('wacli_rejected', 'not authenticated').errorClass).toBe(ERROR_CLASS.PRE_FLIGHT)
    expect(classifyWacliFailure('wacli_rejected', 'invalid phone').errorClass).toBe(ERROR_CLASS.PERMANENTE)
  })

  it('idempotencyKey gera ID determinístico sem carregar o texto original', () => {
    const id = safeMessageId('form:abc:response:def')
    expect(id).toMatch(/^[A-F0-9]{32}$/)
    expect(id).toBe(safeMessageId('form:abc:response:def'))
    expect(id).not.toContain('ABC')
  })
})

describe('transporte WuzAPI', () => {
  const response = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })

  it('preserva acento, emoji e quebras e exige ACK completo do servidor', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(response(200, {
        success: true,
        data: { connected: true, loggedIn: true, jid: '5583996966457@s.whatsapp.net' },
      }))
      .mockResolvedValueOnce(response(200, {
        success: true,
        data: { Details: 'Sent', Id: 'MSG', Timestamp: 123 },
      }))
    const transport = createWuzapiTransport({
      token: 'secret',
      fetchFn,
      url: 'http://127.0.0.1:8080',
    })
    const result = await transport.enviarTexto(
      '5583999999999',
      'Pergunta com acento?\r\nResposta ✅\n\nOutra linha',
      { idempotencyKey: 'form:a:b' },
    )
    expect(result).toEqual(expect.objectContaining({ success: true, messageId: 'MSG' }))
    const request = fetchFn.mock.calls[1][1]
    const body = JSON.parse(request.body)
    expect(body.Body).toBe('Pergunta com acento?\nResposta ✅\n\nOutra linha')
    expect(body.Id).toMatch(/^[A-F0-9]{32}$/)
    expect(request.headers.Token).toBe('secret')
  })

  it('HTTP 200 sem Id/Timestamp é IN_FLIGHT, não falso positivo', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(response(200, {
        success: true,
        data: { connected: true, loggedIn: true },
      }))
      .mockResolvedValueOnce(response(200, {
        success: true,
        data: { Details: 'Sent' },
      }))
    const transport = createWuzapiTransport({ token: 'secret', fetchFn })
    expect(await transport.enviarTexto('5583999999999', 'x')).toEqual(expect.objectContaining({
      success: false,
      errorClass: ERROR_CLASS.IN_FLIGHT,
    }))
  })
})
