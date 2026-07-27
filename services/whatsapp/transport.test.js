import { describe, it, expect, vi } from 'vitest'
import {
  ERROR_CLASS,
  alternateBrazilianPhone,
  sendWithTransportFallback,
} from './transport.js'
import {
  classifyFetchError,
  classifyHttpFailure,
  createWuzapiTransport,
  safeMessageId,
} from './transport-wuzapi.js'
import { classifyWacliFailure } from './transport-wacli.js'

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
