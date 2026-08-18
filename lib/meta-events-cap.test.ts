/**
 * Teto do fan-out de `meta_events` (auditoria 2026-08, lote 2 · L2-6).
 *
 * O defeito: `/api/responses` aceitava o array `meta_events` sem teto de quantidade, sem teto
 * de tamanho, sem dedup e sem whitelist — e cada elemento vira UM `sendMetaCAPIEvent`, todos
 * no mesmo tick. A rota é ANÔNIMA, tem CORS `*` por desenho e é isenta do check de Origin no
 * middleware: um único POST podia gerar milhares de chamadas concorrentes à Meta, com o token
 * e o pixel GLOBAIS da plataforma.
 *
 * O filtro `isRecordableMetaEvent` já existia, mas rodava só no NAVEGADOR — protegia o usuário
 * honesto e mais ninguém.
 *
 * Este arquivo trava a REGRA de normalização (a mesma expressão aplicada na rota) e o guard de
 * defesa em profundidade em `sendMetaCAPIEvent`. Testar a regra isolada mantém o teste legível
 * e independente do mock pesado da rota inteira.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isRecordableMetaEvent } from './pixel-events'

const MAX_META_EVENTS = 25
const MAX_META_EVENT_LEN = 64

/** Cópia fiel da normalização em app/api/responses/route.ts (bloco `metaEvents`). */
function normalizar(raw: unknown): string[] {
  return Array.isArray(raw)
    ? Array.from(
        new Set(
          raw
            .filter((e): e is string => typeof e === 'string')
            .map((e) => e.trim().slice(0, MAX_META_EVENT_LEN))
            .filter(isRecordableMetaEvent)
        )
      ).slice(0, MAX_META_EVENTS)
    : []
}

describe('teto do fan-out de meta_events', () => {
  it('corta o ataque: 5.000 eventos viram no máximo 25', () => {
    const ataque = Array.from({ length: 5000 }, (_, i) => `Evento${i}`)
    expect(normalizar(ataque)).toHaveLength(MAX_META_EVENTS)
  })

  it('deduplica: mil repetições do mesmo evento viram uma chamada', () => {
    // Dedup no Meta é por event_id, então repetir nunca foi útil — só custava POSTs.
    expect(normalizar(Array(1000).fill('Lead'))).toEqual(['Lead'])
  })

  it('trunca nome gigante em 64 caracteres', () => {
    const [saida] = normalizar(['A'.repeat(5000)])
    expect(saida).toHaveLength(MAX_META_EVENT_LEN)
  })

  it('descarta não-strings, vazios e só-espaços sem quebrar', () => {
    expect(normalizar(['Lead', '', '   ', null, 42, {}, undefined])).toEqual(['Lead'])
  })

  it('não altera o caso legítimo — o fluxo normal passa intacto', () => {
    const legitimo = ['Lead', 'CompleteRegistration', 'AnswerSet_A']
    expect(normalizar(legitimo)).toEqual(legitimo)
  })

  it('entrada que não é array vira lista vazia', () => {
    expect(normalizar('Lead')).toEqual([])
    expect(normalizar(undefined)).toEqual([])
    expect(normalizar({ 0: 'Lead' })).toEqual([])
  })
})

describe('sendMetaCAPIEvent: guards antes da rede', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  /** Credencial válida por padrão; cada teste estraga UM campo. */
  const valido = { pixelId: '123456789012345', accessToken: 'tok-valido-com-tamanho', eventName: 'Lead', eventId: 'abc-123' }

  it('recusa eventId ausente ou maior que 64 sem sequer chamar a rede', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { sendMetaCAPIEvent } = await import('./meta-capi')

    await expect(sendMetaCAPIEvent({ ...valido, eventId: '' })).resolves.toBe(false)
    await expect(sendMetaCAPIEvent({ ...valido, eventId: 'x'.repeat(65) })).resolves.toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })

  /**
   * O TESTE QUE IMPORTA (18/08/2026). Antes, este arquivo definia META_PIXEL_ID/META_ACCESS_TOKEN
   * no ambiente porque a função os LIA de lá — era o pixel GLOBAL da plataforma recebendo o lead
   * do cliente. Agora a credencial é parâmetro, e sem ela NADA sai: nem com as variáveis antigas
   * de volta no ambiente. É isto que garante que o fallback global não volte por descuido.
   */
  it('sem credencial do formulário não chama a rede — nem com as variáveis globais antigas setadas', async () => {
    process.env.META_ACCESS_TOKEN = 'token-global-da-plataforma'
    process.env.META_PIXEL_ID = '999999999999999'
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { sendMetaCAPIEvent } = await import('./meta-capi')

    await expect(sendMetaCAPIEvent({ ...valido, pixelId: '', accessToken: '' })).resolves.toBe(false)
    await expect(sendMetaCAPIEvent({ ...valido, accessToken: '' })).resolves.toBe(false)
    await expect(sendMetaCAPIEvent({ ...valido, pixelId: '' })).resolves.toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()

    delete process.env.META_ACCESS_TOKEN
    delete process.env.META_PIXEL_ID
    fetchSpy.mockRestore()
  })

  it('recusa pixel que não é numérico (colagem errada) antes de virar POST', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { sendMetaCAPIEvent } = await import('./meta-capi')

    await expect(sendMetaCAPIEvent({ ...valido, pixelId: 'meu-pixel' })).resolves.toBe(false)
    await expect(sendMetaCAPIEvent({ ...valido, pixelId: '123' })).resolves.toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })

  it('manda o NOME REAL do evento, não Lead fixo', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ events_received: 1 }), { status: 200 }) as never,
    )
    const { sendMetaCAPIEvent } = await import('./meta-capi')

    await sendMetaCAPIEvent({ ...valido, eventName: 'AgendouConsulta' })

    const corpo = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(corpo.data[0].event_name).toBe('AgendouConsulta')
    // O par (nome, id) é o que deduplica com o navegador.
    expect(corpo.data[0].event_id).toBe('abc-123')
    fetchSpy.mockRestore()
  })

  it('usa o pixel do PARÂMETRO na URL, não o do ambiente', async () => {
    process.env.META_PIXEL_ID = '999999999999999'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ events_received: 1 }), { status: 200 }) as never,
    )
    const { sendMetaCAPIEvent } = await import('./meta-capi')

    await sendMetaCAPIEvent({ ...valido, pixelId: '111222333444555' })

    expect(String(fetchSpy.mock.calls[0][0])).toContain('111222333444555')
    expect(String(fetchSpy.mock.calls[0][0])).not.toContain('999999999999999')
    delete process.env.META_PIXEL_ID
    fetchSpy.mockRestore()
  })
})
