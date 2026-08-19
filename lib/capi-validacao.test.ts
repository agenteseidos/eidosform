import { describe, it, expect, vi, afterEach } from 'vitest'
import { validarCredencialCapi } from './meta-capi'

/**
 * A validação do token na hora de salvar.
 *
 * ⚠️ O DEFEITO QUE ISTO TRANCA (18/08/2026, primeiro teste real do Sidney): a primeira versão
 * provava o token com `GET /{pixel-id}` — uma LEITURA. O token gerado pelo fluxo recomendado do
 * Gerenciador de Eventos ("sem a Dataset Quality API") serve para ENVIAR evento e não
 * necessariamente para ler o objeto do pixel. Resultado: token bom reprovado, com uma mensagem
 * dizendo que o Pixel não foi encontrado. O cliente não teria como descobrir que a culpa era nossa.
 *
 * Agora a prova exercita a permissão certa — POST no endpoint de eventos, com lista VAZIA (não
 * cria conversão nenhuma). Verificado contra a API real que o Meta autentica ANTES de validar o
 * payload.
 */
function resposta(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status }) as never
}

afterEach(() => vi.restoreAllMocks())

describe('validarCredencialCapi', () => {
  it('prova a permissão de ENVIO, não a de leitura', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta(200, { events_received: 0 }))
    const r = await validarCredencialCapi('123456789012345', 'token-de-verdade-longo')

    expect(r).toEqual({ estado: 'ok', conclusivo: true })
    const [url, init] = spy.mock.calls[0]
    expect(String(url)).toContain('/events')
    expect((init as RequestInit).method).toBe('POST')
    // Lista vazia: não pode criar conversão na conta do cliente só para validar.
    expect(JSON.parse((init as RequestInit).body as string).data).toEqual([])
  })

  it('token inválido/expirado (190) é recusado', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta(400, { error: { code: 190, message: 'Invalid OAuth access token' } }))
    const r = await validarCredencialCapi('123456789012345', 'token-invalido-longo-aqui')
    expect(r.estado).toBe('recusado')
    expect(r.estado === 'recusado' && r.motivo).toMatch(/inválido ou expirado/i)
  })

  it('token sem permissão no pixel (200) é recusado', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta(403, { error: { code: 200, message: 'Permissions error' } }))
    const r = await validarCredencialCapi('123456789012345', 'token-de-outra-conta-aqui')
    expect(r.estado).toBe('recusado')
  })

  it('código 100 com queixa do PAYLOAD é ACEITO — o token já passou pela autenticação', async () => {
    // Este é o caso que fazia o token bom ser reprovado.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      resposta(400, { error: { code: 100, message: 'The parameter data is required.' } }),
    )
    const r = await validarCredencialCapi('123456789012345', 'token-bom-mas-estreito-aq')
    expect(r).toEqual({ estado: 'ok', conclusivo: false })
  })

  it('código 100 de objeto inexistente CONTINUA sendo recusa', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      resposta(400, { error: { code: 100, message: "Unsupported post request. Object with ID '1' does not exist" } }),
    )
    const r = await validarCredencialCapi('123456789012345', 'token-longo-o-suficiente')
    expect(r.estado).toBe('recusado')
  })

  it('429 e 5xx são TEMPORÁRIOS — não destroem a credencial que já funcionava', async () => {
    for (const status of [429, 500, 503]) {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta(status, {}))
      const r = await validarCredencialCapi('123456789012345', 'token-longo-o-suficiente')
      expect(r.estado).toBe('temporario')
    }
  })

  it('falha de rede é TEMPORÁRIA e a mensagem não mente sobre ter salvado', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNRESET'))
    const r = await validarCredencialCapi('123456789012345', 'token-longo-o-suficiente')
    expect(r.estado).toBe('temporario')
    expect(r.estado === 'temporario' && r.motivo).toMatch(/nada foi alterado/i)
  })

  it('pixel não numérico e token curto são recusados sem tocar na rede', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    expect((await validarCredencialCapi('meu-pixel', 'token-longo-o-suficiente')).estado).toBe('recusado')
    expect((await validarCredencialCapi('123456789012345', 'curto')).estado).toBe('recusado')
    expect(spy).not.toHaveBeenCalled()
  })
})
