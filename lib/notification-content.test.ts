import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildNotificationModel } from './notification-model'
import { buildNewResponseEmail } from './notification-content'
import { sanitizeSubject, SUBJECT_MAX_CHARS } from './resend'

const EVENT_AT = '2026-07-30T17:32:10.000Z' // 30/07/2026 14:32 em São Paulo

function model(overrides: {
  title?: string
  questions?: Array<{ id: string; type?: string; title?: string }>
  responseData?: Record<string, unknown>
  utm?: Record<string, string | null> | null
  metaEvents?: string[]
  eventAt?: string
} = {}) {
  return buildNotificationModel({
    formId: 'form-1',
    responseId: 'resp-1',
    appUrl: 'https://eidosform.com.br',
    eventAt: overrides.eventAt ?? EVENT_AT,
    form: {
      id: 'form-1',
      title: overrides.title ?? 'Psicoterapia',
      user_id: 'u',
      questions: overrides.questions ?? [
        { id: 'q_nome', type: 'short_text', title: 'Qual seu nome?' },
        { id: 'q_tel', type: 'phone', title: 'Seu WhatsApp' },
      ],
    },
    responseData: overrides.responseData ?? { q_nome: 'maria fernanda souza', q_tel: '83999998888' },
    utm: overrides.utm ?? null,
    metaEvents: overrides.metaEvents,
  })
}

afterEach(() => vi.useRealTimers())

describe('assunto', () => {
  it('com nome: nome primeiro, depois o formulário', () => {
    expect(buildNewResponseEmail(model()).subject).toBe('Novo lead: Maria Fernanda Souza — Psicoterapia')
  })

  it('sem nome coletado: cai para "Novo lead em {formulário}"', () => {
    const m = model({
      questions: [{ id: 'q', type: 'long_text', title: 'Conta aí' }],
      responseData: { q: 'oi' },
    })
    expect(buildNewResponseEmail(m).subject).toBe('Novo lead em Psicoterapia')
  })

  it('título longo: ao truncar, o NOME sobrevive (é o que serve pra triagem)', () => {
    const m = model({ title: 'Formulário de Captação de Pacientes para Terapia Online com Abordagem Gestáltica 2026' })
    const truncado = sanitizeSubject(buildNewResponseEmail(m).subject)
    expect(truncado.length).toBeLessThanOrEqual(SUBJECT_MAX_CHARS)
    expect(truncado.startsWith('Novo lead: Maria Fernanda Souza —')).toBe(true)
    expect(truncado.endsWith('...')).toBe(true)
  })
})

describe('escape de conteúdo hostil', () => {
  const hostil = model({
    title: '<img src=x onerror=alert(1)>',
    questions: [
      { id: 'q_nome', type: 'short_text', title: 'Qual seu nome?' },
      { id: 'q_evil', type: 'short_text', title: '<script>alert("titulo")</script>' },
    ],
    responseData: {
      q_nome: '<script>alert("nome")</script>',
      q_evil: '"><img src=x onerror=alert(2)>',
    },
  })

  it('HTML: nada de tag viva vinda do lead — nome, TÍTULO DA PERGUNTA e resposta', () => {
    const { html } = buildNewResponseEmail(hostil)

    // A propriedade que importa não é "a string some" (o texto escapado
    // legitimamente contém `onerror=` dentro de &lt;...&gt;), e sim: as ÚNICAS
    // tags VIVAS do documento são as nossas, e nenhuma tem handler de evento.
    const NOSSAS_TAGS = new Set(['div', 'h2', 'h3', 'p', 'strong', 'em', 'table', 'tr', 'td', 'a', 'br'])
    const tagsVivas = [...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1].toLowerCase())
    expect([...new Set(tagsVivas)].filter((t) => !NOSSAS_TAGS.has(t))).toEqual([])
    expect(html).not.toMatch(/<[^>]+\son[a-z]+\s*=/i) // nenhum onerror=/onclick= vivo

    // e o conteúdo continua legível, escapado
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;')
  })

  it('o título do FORMULÁRIO também é escapado (vem do dono, mas é texto livre)', () => {
    const { html } = buildNewResponseEmail(hostil)
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('texto puro: entrega o conteúdo inerte, sem caractere de controle/invisível', () => {
    const m = model({
      responseData: {
        q_nome: 'Ma​ria\r\nBcc: alguem@x.com',
        q_tel: '83999998888',
      },
    })
    const { text } = buildNewResponseEmail(m)
    expect(text).not.toContain('​') // zero-width removido
    expect(text).not.toContain('\r')
  })
})

describe('linha de origem (UTM) — self-hide', () => {
  it('some por completo quando o lead chegou sem UTM', () => {
    const { html, text } = buildNewResponseEmail(model({ utm: null }))
    expect(html).not.toContain('Origem:')
    expect(text).not.toContain('Origem:')
  })

  it('aparece com UMA só UTM presente', () => {
    const m = model({ utm: { utm_source: 'facebook', utm_medium: null, utm_campaign: null, utm_term: null, utm_content: null } })
    const { html, text } = buildNewResponseEmail(m)
    expect(html).toContain('Origem: facebook')
    expect(text).toContain('Origem: facebook')
  })
})

describe('sinais de conversão', () => {
  it('somem quando não há evento registrado', () => {
    const { html, text } = buildNewResponseEmail(model({ metaEvents: [] }))
    expect(html).not.toContain('Sinais de conversão')
    expect(text).not.toContain('Sinais de conversão')
  })

  it('usam o rótulo honesto e NUNCA prometem entrega às plataformas', () => {
    const { html, text } = buildNewResponseEmail(model({ metaEvents: ['Lead', 'LeadQualificado'] }))
    for (const body of [html, text]) {
      expect(body).toContain('Sinais de conversão registrados nesta resposta')
      expect(body).toContain('não confirma recebimento pelas plataformas de anúncios')
      expect(body).not.toContain('Eventos Meta')
      expect(body).not.toContain('eventos disparados')
      expect(body).not.toContain('eventos entregues')
    }
  })
})

describe('botão de WhatsApp', () => {
  it('vira wa.me com DDI quando o telefone é válido', () => {
    const { html, text } = buildNewResponseEmail(model())
    expect(html).toContain('https://wa.me/5583999998888')
    expect(text).toContain('https://wa.me/5583999998888')
  })

  it('some quando não há telefone válido (nunca chuta número)', () => {
    const m = model({
      questions: [{ id: 'q_nome', type: 'short_text', title: 'Qual seu nome?' }],
      responseData: { q_nome: 'maria' },
    })
    const { html, text } = buildNewResponseEmail(m)
    expect(html).not.toContain('wa.me')
    expect(text).not.toContain('wa.me')
  })
})

describe('horário do evento', () => {
  it('usa o timestamp PERSISTIDO, não o relógio do envio', () => {
    // Relógio do "envio" 3 dias depois do lead: o e-mail tem que mostrar o LEAD.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-02T10:00:00.000Z'))
    const { html, text } = buildNewResponseEmail(model())
    expect(html).toContain('30/07/2026 às 14:32')
    expect(text).toContain('30/07/2026 às 14:32')
    expect(html).not.toContain('02/08/2026')
  })

  it('eventAt inválido não quebra o e-mail — a linha simplesmente some', () => {
    const { html } = buildNewResponseEmail(model({ eventAt: 'nao-e-data' }))
    expect(html).not.toContain('Recebido em')
    expect(html).toContain('Ver no painel')
  })
})

describe('corpo', () => {
  it('traz as respostas em tabela e o botão do painel', () => {
    const { html } = buildNewResponseEmail(model())
    expect(html).toContain('<table')
    expect(html).toContain('Qual seu nome?')
    expect(html).toContain('maria fernanda souza')
    expect(html).toContain('https://eidosform.com.br/forms/form-1/responses?response=resp-1')
  })

  it('não mostra pergunta sem resposta', () => {
    const m = model({
      questions: [
        { id: 'q_nome', type: 'short_text', title: 'Qual seu nome?' },
        { id: 'q_vazia', type: 'long_text', title: 'Algo mais?' },
      ],
      responseData: { q_nome: 'maria', q_vazia: '' },
    })
    expect(buildNewResponseEmail(m).html).not.toContain('Algo mais?')
  })
})
