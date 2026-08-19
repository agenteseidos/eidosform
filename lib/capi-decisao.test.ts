import { describe, it, expect } from 'vitest'
import { decidirEnviosCapi } from './meta-capi'
import { derivarEventosAutorizados, linkConfiguracoesDoPixel } from './pixel-events'
import type { PixelEventRule } from '@/types/pixel-events'

/**
 * A regra de quem é enviado ao Meta PELO SERVIDOR.
 *
 * Dois defeitos estão trancados aqui, ambos achados por parecer independente em 18/08/2026:
 *
 *  1. **Evento escolhido por quem posta.** O submit de formulário publicado é ANÔNIMO. A lista
 *     `meta_events` vinha do corpo do POST e o filtro existente era uma lista de BLOQUEIO — só
 *     recusava PageView e afins. Qualquer um podia mandar `Purchase` e o servidor dispararia no
 *     pixel do CLIENTE, com o token verdadeiro dele.
 *  2. **Fallback global.** Antes desta data o envio usava pixel e token da plataforma: o lead do
 *     cliente ia para o ativo do Instituto Eidos.
 *
 * Se alguém "consertar" qualquer um dos dois no futuro, estes testes quebram.
 */

const autorizados = new Map<string, { value?: number; currency?: string } | null>([
  ['Lead', null],
  ['AgendouConsulta', null],
])

const base = {
  planoPermite: true,
  pixelId: '123456789012345',
  token: 'token-do-cliente',
  ocorrencias: [
    { name: 'Lead', id: 'id-1' },
    { name: 'AgendouConsulta', id: 'id-2' },
  ],
  autorizados,
}

describe('decidirEnviosCapi', () => {
  it('com pixel e token do formulário, envia cada ocorrência com o id do navegador', () => {
    expect(decidirEnviosCapi(base)).toEqual([
      { eventName: 'Lead', eventId: 'id-1' },
      { eventName: 'AgendouConsulta', eventId: 'id-2' },
    ])
  })

  it('SEM token do formulário não envia NADA — não existe fallback global', () => {
    expect(decidirEnviosCapi({ ...base, token: null })).toEqual([])
    expect(decidirEnviosCapi({ ...base, token: '' })).toEqual([])
  })

  it('SEM pixel do formulário não envia NADA', () => {
    expect(decidirEnviosCapi({ ...base, pixelId: null })).toEqual([])
    expect(decidirEnviosCapi({ ...base, pixelId: '   ' })).toEqual([])
  })

  it('plano sem o recurso não envia nada, mesmo com credencial completa', () => {
    expect(decidirEnviosCapi({ ...base, planoPermite: false })).toEqual([])
  })

  /** ⚠️ O TESTE DO ATAQUE. */
  it('evento que o dono NÃO configurou é descartado, mesmo vindo no POST', () => {
    const ataque = decidirEnviosCapi({
      ...base,
      ocorrencias: [
        { name: 'Purchase', id: 'forjado-1' },
        { name: 'ConversaoInventada', id: 'forjado-2' },
        { name: 'Lead', id: 'id-1' },
      ],
    })
    // Só o que a configuração do formulário autoriza sobrevive.
    expect(ataque).toEqual([{ eventName: 'Lead', eventId: 'id-1' }])
  })

  it('lista de autorizados vazia mata tudo — formulário sem evento configurado não gera CAPI', () => {
    expect(decidirEnviosCapi({ ...base, autorizados: new Map() })).toEqual([])
  })

  it('PIXEL TROCADO depois da validação bloqueia o envio até revalidar', () => {
    // O token foi aprovado contra OUTRO pixel; o par não é mais o que validamos.
    expect(decidirEnviosCapi({ ...base, pixelValidado: '999999999999999' })).toEqual([])
    // Mesmo pixel = segue normal.
    expect(decidirEnviosCapi({ ...base, pixelValidado: '123456789012345' })).toHaveLength(2)
    // Credencial antiga, sem pixel registrado, não é bloqueada.
    expect(decidirEnviosCapi({ ...base, pixelValidado: null })).toHaveLength(2)
  })

  it('ocorrência sem id é descartada — sem par não há deduplicação', () => {
    const r = decidirEnviosCapi({
      ...base,
      ocorrencias: [{ name: 'Lead', id: 'id-1' }, { name: 'AgendouConsulta', id: '' }],
    })
    expect(r).toEqual([{ eventName: 'Lead', eventId: 'id-1' }])
  })

  it('duas ocorrências do MESMO nome com ids diferentes são dois envios', () => {
    // O Meta exige event_id único por ocorrência: dois disparos legítimos = dois eventos.
    const r = decidirEnviosCapi({
      ...base,
      ocorrencias: [{ name: 'Lead', id: 'id-a' }, { name: 'Lead', id: 'id-b' }],
    })
    expect(r).toEqual([
      { eventName: 'Lead', eventId: 'id-a' },
      { eventName: 'Lead', eventId: 'id-b' },
    ])
  })

  it('id repetido no mesmo POST manda uma vez só', () => {
    const r = decidirEnviosCapi({
      ...base,
      ocorrencias: [{ name: 'Lead', id: 'igual' }, { name: 'Lead', id: 'igual' }],
    })
    expect(r).toHaveLength(1)
  })

  it('value/currency vêm da CONFIGURAÇÃO, não do POST', () => {
    const r = decidirEnviosCapi({
      ...base,
      ocorrencias: [{ name: 'Compra', id: 'id-x' }],
      autorizados: new Map([['Compra', { value: 197, currency: 'BRL' }]]),
    })
    expect(r).toEqual([{ eventName: 'Compra', eventId: 'id-x', value: 197, currency: 'BRL' }])
  })
})

describe('derivarEventosAutorizados', () => {
  const perguntas: Array<{ id: string; pixelEvents?: PixelEventRule[] }> = [
    { id: 'q1', pixelEvents: [{ id: 'r1', condition: { operator: 'equals', value: 'sim' }, event: { type: 'custom', name: 'Qualificado' } }] },
    { id: 'q2' },
  ]

  it('autoriza os eventos configurados de início e conclusão', () => {
    const r = derivarEventosAutorizados({
      onStart: 'Comecou', onComplete: 'Terminou',
      answerSetEvents: null, questions: perguntas, answers: {},
    })
    expect([...r.keys()]).toEqual(expect.arrayContaining(['Comecou', 'Terminou']))
  })

  it('REAVALIA a condição da pergunta contra as respostas recebidas', () => {
    const bateu = derivarEventosAutorizados({
      onStart: null, onComplete: null, answerSetEvents: null,
      questions: perguntas, answers: { q1: 'sim' },
    })
    expect(bateu.has('Qualificado')).toBe(true)

    // Resposta que NÃO bate não autoriza — confiar no navegador aqui deixaria a mesma porta aberta.
    const naoBateu = derivarEventosAutorizados({
      onStart: null, onComplete: null, answerSetEvents: null,
      questions: perguntas, answers: { q1: 'nao' },
    })
    expect(naoBateu.has('Qualificado')).toBe(false)
  })

  it('formulário sem configuração nenhuma não autoriza nada', () => {
    const r = derivarEventosAutorizados({
      onStart: null, onComplete: null, answerSetEvents: null,
      questions: [{ id: 'q1' }], answers: { q1: 'x' },
    })
    expect(r.size).toBe(0)
  })

  it('guarda value/currency da configuração do evento', () => {
    const r = derivarEventosAutorizados({
      onStart: null, onComplete: null, answerSetEvents: null,
      questions: [{ id: 'q1', pixelEvents: [{ id: 'r', condition: { operator: 'is_not_empty' }, event: { type: 'standard', name: 'Purchase', value: 97, currency: 'BRL' } }] as PixelEventRule[] }],
      answers: { q1: 'algo' },
    })
    expect(r.get('Purchase')).toEqual({ type: 'standard', name: 'Purchase', value: 97, currency: 'BRL' })
  })
})

describe('linkConfiguracoesDoPixel', () => {
  /**
   * O bug que isto tranca (18/08/2026): o link era montado com o valor cru do campo, e um Pixel
   * vazio virava `.../list/dataset//settings` — 404 na cara do cliente. Agora o caso impossível
   * não pode ser construído: sem Pixel válido não há URL.
   */
  it('monta o endereço da aba Configurações do pixel', () => {
    expect(linkConfiguracoesDoPixel('3978654055741467'))
      .toBe('https://eventsmanager.facebook.com/events_manager2/list/dataset/3978654055741467/settings')
  })

  it('devolve null sem Pixel — nunca uma URL com o id vazio', () => {
    for (const vazio of ['', '   ', null, undefined]) {
      expect(linkConfiguracoesDoPixel(vazio)).toBeNull()
    }
    // E o resultado nunca pode conter a barra dupla que gerava o 404.
    expect(String(linkConfiguracoesDoPixel('') ?? '')).not.toContain('dataset//')
  })

  it('devolve null para valor que não é Pixel', () => {
    expect(linkConfiguracoesDoPixel('meu-pixel')).toBeNull()
    expect(linkConfiguracoesDoPixel('123')).toBeNull()
    expect(linkConfiguracoesDoPixel('12345678901234567890123')).toBeNull()
  })

  it('NUNCA carrega identificador de conta na URL', () => {
    // A URL que se copia do navegador vem com business_id/act/nav_source — eles identificam a
    // conta de quem copiou e não podem ser servidos a outro cliente.
    const url = linkConfiguracoesDoPixel('3978654055741467')!
    expect(url).not.toContain('business_id')
    expect(url).not.toContain('act=')
    expect(url).not.toContain('nav_source')
    expect(url).not.toContain('?')
  })
})
