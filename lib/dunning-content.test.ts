/**
 * D-01 · os textos — o que trava aqui são as decisões de redação do Sidney, não a estética.
 * Cada uma delas nasceu de uma correção dele durante a revisão, e regredir custa cliente.
 */
import { describe, it, expect } from 'vitest'
import { TEXTOS_DUNNING, preencher } from './dunning-content'

const ESTAGIOS = [0, 1, 2, 3, 4, 5] as const
const todosOsTextos = (e: (typeof ESTAGIOS)[number]) =>
  [TEXTOS_DUNNING[e].assunto, ...TEXTOS_DUNNING[e].paragrafos, TEXTOS_DUNNING[e].whatsappBody].join(' ')

describe('🛡️ o cliente comprou do Instituto Eidos', () => {
  it('NENHUM texto cita a plataforma de cobrança', () => {
    // Correção do Sidney: "o cliente não comprou do Asaas, comprou do Instituto Eidos.
    // Ele vai pensar: o que é asaas?"
    for (const e of ESTAGIOS) {
      expect(todosOsTextos(e).toLowerCase()).not.toContain('asaas')
    }
  })

  it('todos falam de EidosForm', () => {
    for (const e of ESTAGIOS) expect(todosOsTextos(e)).toContain('EidosForm')
  })
})

describe('🛡️ o problema é o pagamento, nunca a pessoa', () => {
  it('nenhum texto culpa o cliente', () => {
    for (const e of ESTAGIOS) {
      const t = todosOsTextos(e).toLowerCase()
      expect(t).not.toMatch(/você não pagou|inadimplente|devedor|em atraso com/)
    }
  })

  it('nenhum texto diz que algo "deixa de existir" ou é apagado', () => {
    // O Sidney pediu "deixar de existir"; corrigi porque é falso e caro: quem acha que perdeu
    // o trabalho não volta. Os formulários PAUSAM.
    for (const e of ESTAGIOS) {
      const t = todosOsTextos(e).toLowerCase()
      expect(t).not.toContain('deixar de existir')
      expect(t).not.toMatch(/ser[aã]o? (apagad|exclu[ií]d|delet)/)
    }
  })
})

describe('🛡️ "nada é apagado" onde a queda é mencionada', () => {
  it.each([0, 1, 2, 3, 4, 5])('estágio %i tranquiliza sobre os dados', (e) => {
    const t = todosOsTextos(e as (typeof ESTAGIOS)[number]).toLowerCase()
    expect(t).toMatch(/nada é apagado|nenhum dado foi perdido/)
  })
})

describe('a escalada de urgência é gradual (nada de apelação no dia 1)', () => {
  it('D+0 e D+1 NÃO falam em perder leads', () => {
    for (const e of [0, 1] as const) {
      expect(TEXTOS_DUNNING[e].assunto.toLowerCase()).not.toMatch(/perde|deixa de ser avisado|param de receber/)
    }
  })

  it('do D+3 em diante o assunto nomeia a perda CONCRETA', () => {
    expect(TEXTOS_DUNNING[3].assunto).toMatch(/deixa de ser avisado dos seus leads/i)
    expect(TEXTOS_DUNNING[4].assunto).toMatch(/param de receber respostas/i)
  })

  it('a contagem regressiva bate com o prazo de 5 dias', () => {
    expect(TEXTOS_DUNNING[1].assunto).toContain('4 dias')
    expect(TEXTOS_DUNNING[2].assunto).toContain('3 dias')
    expect(TEXTOS_DUNNING[3].assunto).toContain('2 dias')
    expect(TEXTOS_DUNNING[4].assunto.toLowerCase()).toContain('amanhã')
  })
})

describe('os limites do gratuito são concretos onde importa', () => {
  it('estágios de 0 a 4 dizem os números (3 formulários, 100 respostas)', () => {
    for (const e of [0, 1, 2, 3, 4] as const) {
      const t = todosOsTextos(e)
      expect(t).toMatch(/3 formulários/)
      expect(t).toMatch(/100 respostas/)
    }
  })
})

describe('paridade entre os canais', () => {
  it('todo estágio tem e-mail E template de WhatsApp', () => {
    for (const e of ESTAGIOS) {
      expect(TEXTOS_DUNNING[e].paragrafos.length).toBeGreaterThan(0)
      expect(TEXTOS_DUNNING[e].whatsappBody.length).toBeGreaterThan(40)
      expect(TEXTOS_DUNNING[e].whatsappTemplate).toMatch(/^eidosform_cobranca_d\d_v\d$/)
    }
  })

  it('nomes de template únicos por estágio', () => {
    const nomes = ESTAGIOS.map((e) => TEXTOS_DUNNING[e].whatsappTemplate)
    expect(new Set(nomes).size).toBe(nomes.length)
  })

  it('o WhatsApp usa {{1}} e {{2}} na ordem nome, plano', () => {
    for (const e of ESTAGIOS) {
      const corpo = TEXTOS_DUNNING[e].whatsappBody
      expect(corpo.indexOf('{{1}}')).toBeGreaterThanOrEqual(0)
      if (corpo.includes('{{2}}')) expect(corpo.indexOf('{{1}}')).toBeLessThan(corpo.indexOf('{{2}}'))
    }
  })

  it('o e-mail NÃO deixa placeholder de WhatsApp vazando, nem vice-versa', () => {
    for (const e of ESTAGIOS) {
      expect(TEXTOS_DUNNING[e].paragrafos.join(' ')).not.toContain('{{')
      expect(TEXTOS_DUNNING[e].whatsappBody).not.toMatch(/\{nome\}|\{plano\}/)
    }
  })
})

describe('preencher', () => {
  it('troca nome e plano em todas as ocorrências', () => {
    const r = preencher('Olá, {nome}! Seu {plano} — volte ao {plano}.', { nome: 'Julia', plano: 'Plus' })
    expect(r).toBe('Olá, Julia! Seu Plus — volte ao Plus.')
  })

  it('texto sem placeholder passa intacto', () => {
    expect(preencher('sem variável', { nome: 'x', plano: 'y' })).toBe('sem variável')
  })
})
