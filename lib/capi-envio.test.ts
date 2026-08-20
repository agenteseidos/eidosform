import { describe, it, expect, vi, afterEach } from 'vitest'
import { enviarLinhaCapi } from './meta-capi'

vi.mock('./logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }))

/**
 * A classificação do desfecho de envio — o que o worker usa para decidir entre retentar,
 * bloquear por auth ou matar a linha. O envio antigo devolvia boolean para tudo; o worker
 * martelaria token revogado de hora em hora e desistiria de falha passageira.
 */
function resposta(status: number, corpo: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(corpo), { status, headers }) as never
}

const linha = {
  pixelId: '123456789012345', accessToken: 'token-longo-de-verdade-aqui',
  eventName: 'Lead', eventId: 'uuid-estavel-da-linha', eventTime: new Date().toISOString(),
  userData: { em: ['hash'] },
}

afterEach(() => vi.restoreAllMocks())

describe('enviarLinhaCapi', () => {
  it('2xx = enviado, com o event_id DA LINHA no payload (retentativa nunca gera id novo)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta(200, { events_received: 1 }))
    const r = await enviarLinhaCapi(linha)
    expect(r).toEqual({ tipo: 'enviado' })
    const corpo = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string)
    expect(corpo.data[0].event_id).toBe('uuid-estavel-da-linha')
    // Token no CORPO, nunca na URL (telemetria e trace registram URL).
    expect(String(spy.mock.calls[0][0])).not.toContain('token-longo')
  })

  it('190/200/403 = bloqueado por auth — parar de martelar, religa quando trocarem o token', async () => {
    for (const [status, code] of [[400, 190], [403, 200], [401, undefined]] as const) {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta(status, { error: { code } }))
      const r = await enviarLinhaCapi(linha)
      expect(r.tipo).toBe('bloqueado_auth')
      vi.restoreAllMocks()
    }
  })

  it('429/5xx/is_transient = retentável, respeitando Retry-After', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta(429, { error: { code: 4 } }, { 'retry-after': '30' }))
    const r = await enviarLinhaCapi(linha)
    expect(r).toMatchObject({ tipo: 'retentavel', retryAfterS: 30 })

    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta(400, { error: { code: 2, is_transient: true } }))
    expect((await enviarLinhaCapi(linha)).tipo).toBe('retentavel')
  })

  it('rede/timeout = retentável — o Meta pode ter aceitado e a resposta se perdido', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ETIMEDOUT'))
    expect((await enviarLinhaCapi(linha)).tipo).toBe('retentavel')
  })

  it('4xx de payload = morto — repetir daria o mesmo erro para sempre', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta(400, { error: { code: 100 } }))
    expect((await enviarLinhaCapi(linha)).tipo).toBe('morto')
  })

  it('NUNCA loga o corpo cru da resposta do Meta', async () => {
    // O redator central mascara chaves chamadas "token", não tokens dentro de string arbitrária.
    const { logError } = await import('./logger')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      resposta(400, { error: { code: 100, message: 'echo perigoso: token-longo-de-verdade-aqui' } }),
    )
    await enviarLinhaCapi(linha)
    const chamadas = JSON.stringify((logError as ReturnType<typeof vi.fn>).mock?.calls ?? [])
    expect(chamadas).not.toContain('token-longo-de-verdade-aqui')
  })
})
