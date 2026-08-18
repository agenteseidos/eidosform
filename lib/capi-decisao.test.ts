import { describe, it, expect } from 'vitest'
import { decidirEnviosCapi } from './meta-capi'

/**
 * A regra de quem é enviado ao Meta PELO SERVIDOR.
 *
 * O defeito que estes testes trancam (18/08/2026): antes desta data o envio server-side usava um
 * pixel e um token GLOBAIS da plataforma. O cliente colava o pixel dele no construtor, acreditava
 * que a conversão ia para a conta dele, e o servidor mandava tudo — inclusive e-mail e telefone
 * hasheados do lead DELE — para a nossa. Se algum dia alguém "consertar" isto colocando um
 * fallback global de volta "para não perder evento", estes testes quebram.
 */

const base = {
  planoPermite: true,
  pixelId: '123456789012345',
  token: 'token-do-cliente',
  eventos: ['Lead', 'AgendouConsulta'],
  eventIds: { Lead: 'id-1', AgendouConsulta: 'id-2' },
}

describe('decidirEnviosCapi', () => {
  it('com pixel e token do formulário, envia cada evento com o id do navegador', () => {
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

  it('evento SEM id do navegador é descartado — sem par não há deduplicação', () => {
    // Este é o teste que impede a conversão contada em dobro: navegador manda "Lead",
    // servidor manda "Lead", e sem id igual o Meta registra dois leads.
    const r = decidirEnviosCapi({ ...base, eventIds: { Lead: 'id-1' } })
    expect(r).toEqual([{ eventName: 'Lead', eventId: 'id-1' }])
  })

  it('nenhum evento com id → lista vazia, sem chamada de rede', () => {
    expect(decidirEnviosCapi({ ...base, eventIds: {} })).toEqual([])
  })

  it('lista de eventos vazia devolve vazio', () => {
    expect(decidirEnviosCapi({ ...base, eventos: [] })).toEqual([])
  })
})
