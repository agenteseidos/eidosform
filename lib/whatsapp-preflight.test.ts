import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

/**
 * O PORTEIRO DO CANAL WHATSAPP — e o defeito que ele mesmo escondeu por 8 dias.
 *
 * ⚠️ HISTÓRIA (22/08/2026): a versão original montava a consulta de templates como
 * `?name=["a","b"]` — um ARRAY JSON. A Graph API aceita `name` com UM nome só; array e CSV
 * devolvem ZERO linhas, sem erro. O porteiro lia lista vazia como "template inexistente" e
 * FECHAVA o canal. Consequência: o WhatsApp da régua de cobrança NUNCA pôde sair desde 14/08.
 * Ficou invisível porque o canal estava atrás de uma flag; quando o Sidney ligou, a régua
 * silenciava todo dia e só o e-mail chegava — sintoma idêntico a "ainda não é a hora".
 *
 * ⚠️ POR QUE ESTES TESTES SÃO DE FORMATO DE URL, e não de comportamento com mock: um mock
 * devolveria a lista que EU escolhesse, e passaria feliz com a URL errada. Foi exatamente a
 * lição de 20/08 ("mock não prova contrato"). O que dá para trancar aqui é a FORMA da chamada;
 * a prova do contrato é a sonda real, registrada no comentário do módulo.
 */
const CREDS = { WHATSAPP_CLOUD_TOKEN: 'tok', WHATSAPP_WABA_ID: '999', WHATSAPP_CLOUD_PHONE_ID: '111' }

function respostaGraph(templates: Array<{ name: string; status: string; category: string }>, quality = 'GREEN') {
  return (url: string) => {
    const corpo = url.includes('message_templates')
      ? { data: templates }
      : { quality_rating: quality }
    return Promise.resolve(new Response(JSON.stringify(corpo), { status: 200 }) as never)
  }
}

beforeEach(() => {
  vi.resetModules()
  Object.assign(process.env, CREDS)
})
afterEach(() => vi.restoreAllMocks())

describe('preflightWhatsAppDunning — forma da consulta', () => {
  it('NÃO manda os nomes como array JSON nem CSV no parâmetro name', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      ((u: string) => respostaGraph([
        { name: 'a', status: 'APPROVED', category: 'UTILITY' },
        { name: 'b', status: 'APPROVED', category: 'UTILITY' },
      ])(String(u))) as never,
    )
    const { preflightWhatsAppDunning } = await import('./whatsapp-preflight')
    await preflightWhatsAppDunning(['a', 'b'], Date.now())

    const urlTemplates = spy.mock.calls.map((c) => String(c[0])).find((u) => u.includes('message_templates'))!
    // O defeito exato: `name=%5B%22a%22...` (array JSON) devolvia 0 linhas na API real.
    expect(urlTemplates).not.toContain('name=%5B')
    expect(urlTemplates).not.toMatch(/name=[^&]*(,|%2C)/)
    // Sem filtro por nome: busca todas e filtra em código.
    expect(urlTemplates).not.toMatch(/[?&]name=/)
    expect(urlTemplates).toContain('message_templates')
  })

  it('filtra os templates pedidos EM CÓDIGO, a partir da lista completa', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      ((u: string) => respostaGraph([
        { name: 'irrelevante', status: 'REJECTED', category: 'MARKETING' },
        { name: 'cobranca', status: 'APPROVED', category: 'UTILITY' },
      ])(String(u))) as never,
    )
    const { preflightWhatsAppDunning } = await import('./whatsapp-preflight')
    // O template REJEITADO que não foi pedido não pode derrubar o canal.
    expect(await preflightWhatsAppDunning(['cobranca'], Date.now())).toMatchObject({ pode: true })
  })
})

describe('preflightWhatsAppDunning — as recusas (fail-closed)', () => {
  const casos: Array<[string, Array<{ name: string; status: string; category: string }>, string, string]> = [
    ['template ausente da WABA', [{ name: 'outro', status: 'APPROVED', category: 'UTILITY' }], 'GREEN', 'template_inexistente'],
    ['template não aprovado', [{ name: 'x', status: 'PENDING', category: 'UTILITY' }], 'GREEN', 'template_nao_aprovado'],
    ['template virou MARKETING', [{ name: 'x', status: 'APPROVED', category: 'MARKETING' }], 'GREEN', 'template_nao_utility'],
  ]
  for (const [nome, tpls, q, motivo] of casos) {
    it(`recusa: ${nome}`, async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(((u: string) => respostaGraph(tpls, q)(String(u))) as never)
      const { preflightWhatsAppDunning } = await import('./whatsapp-preflight')
      const r = await preflightWhatsAppDunning(['x'], Date.now())
      expect(r).toMatchObject({ pode: false, motivo })
    })
  }

  it('sem credenciais, o canal fecha — nunca tenta enviar no escuro', async () => {
    delete process.env.WHATSAPP_CLOUD_TOKEN
    const { preflightWhatsAppDunning } = await import('./whatsapp-preflight')
    expect(await preflightWhatsAppDunning(['x'], Date.now())).toMatchObject({ pode: false, motivo: 'credenciais_ausentes' })
  })

  it('rede caída fecha o canal em vez de liberar', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNRESET'))
    const { preflightWhatsAppDunning } = await import('./whatsapp-preflight')
    expect((await preflightWhatsAppDunning(['x'], Date.now())).pode).toBe(false)
  })

  it('lista de templates vazia fecha o canal', async () => {
    const { preflightWhatsAppDunning } = await import('./whatsapp-preflight')
    expect(await preflightWhatsAppDunning([], Date.now())).toMatchObject({ pode: false, motivo: 'sem_templates' })
  })
})
