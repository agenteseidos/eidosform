import { describe, it, expect } from 'vitest'
import { recomendarPlano, normalizarTelefoneBR, normalizarEmail } from './regua'
import { validarContratoForm, MIGRACAO } from './config'
import type { QuestionConfig } from '@/lib/database.types'

describe('normalizarTelefoneBR', () => {
  it('remove o 9º dígito BR (13→12)', () => {
    expect(normalizarTelefoneBR('5583999378937')).toBe('558399378937')
  })
  it('mantém o de 12 dígitos', () => {
    expect(normalizarTelefoneBR('558399378937')).toBe('558399378937')
  })
  it('limpa máscara/símbolos', () => {
    expect(normalizarTelefoneBR('+55 (83) 99937-8937')).toBe('558399378937')
  })
  it('lida com nulo/vazio', () => {
    expect(normalizarTelefoneBR(null)).toBe('')
    expect(normalizarTelefoneBR(undefined)).toBe('')
  })
})

describe('normalizarEmail', () => {
  it('trim + minúsculas', () => {
    expect(normalizarEmail('  Foo@Bar.com ')).toBe('foo@bar.com')
  })
})

describe('recomendarPlano — respostas/mês', () => {
  it('Até 100 → free', () => {
    expect(recomendarPlano({ respostasMes: 'Até 100' })).toEqual({ tier: 'free', flags: [] })
  })
  it('100 a 1.000 → starter', () => {
    expect(recomendarPlano({ respostasMes: '100 a 1.000' }).tier).toBe('starter')
  })
  it('1.000 a 5.000 → plus', () => {
    expect(recomendarPlano({ respostasMes: '1.000 a 5.000' }).tier).toBe('plus')
  })
  it('5.000 a 15.000 → professional', () => {
    expect(recomendarPlano({ respostasMes: '5.000 a 15.000' }).tier).toBe('professional')
  })
  it('Mais de 15.000 → professional + acima_do_limite', () => {
    const r = recomendarPlano({ respostasMes: 'Mais de 15.000' })
    expect(r.tier).toBe('professional')
    expect(r.flags).toContain('acima_do_limite')
  })
  it('valor desconhecido → requer_analise (não cai em free silencioso)', () => {
    const r = recomendarPlano({ respostasMes: 'sei lá umas mil' })
    expect(r.flags).toContain('requer_analise')
  })
})

describe('recomendarPlano — perguntas (maior form)', () => {
  it('51 a 100 → plus', () => {
    expect(recomendarPlano({ maiorForm: '51 a 100' }).tier).toBe('plus')
  })
  it('Mais de 100 → professional + requer_analise (101–200 ok ou >200)', () => {
    const r = recomendarPlano({ maiorForm: 'Mais de 100' })
    expect(r.tier).toBe('professional')
    expect(r.flags).toContain('requer_analise')
  })
})

describe('recomendarPlano — recursos e forms', () => {
  it('Pixels eleva pra plus mesmo com volume baixo', () => {
    const r = recomendarPlano({ respostasMes: 'Até 100', recursos: ['Pixels e rastreamento (Meta, Google, TikTok)'] })
    expect(r.tier).toBe('plus')
  })
  it('Domínio próprio eleva pra professional', () => {
    const r = recomendarPlano({ respostasMes: 'Até 100', recursos: ['Domínio próprio'] })
    expect(r.tier).toBe('professional')
  })
  it('CPF/CNPJ e Sheets elevam pra starter', () => {
    const r = recomendarPlano({ recursos: ['Validação de CPF/CNPJ', 'Google Sheets'] })
    expect(r.tier).toBe('starter')
  })
  it('Lógica condicional e "nada disso" não elevam', () => {
    const r = recomendarPlano({ respostasMes: 'Até 100', recursos: ['Lógica condicional (pular perguntas)', 'Ainda não uso nada disso'] })
    expect(r.tier).toBe('free')
  })
  it('>10 forms → flag de política, tier starter', () => {
    const r = recomendarPlano({ qtdForms: 12 })
    expect(r.tier).toBe('starter')
    expect(r.flags).toContain('acima_do_beneficio')
  })
  it('≤3 forms → free', () => {
    expect(recomendarPlano({ qtdForms: 2 }).tier).toBe('free')
  })
  it('pega o MAIOR tier entre dimensões', () => {
    const r = recomendarPlano({ respostasMes: '1.000 a 5.000', maiorForm: '26 a 50', recursos: ['Google Sheets'] })
    expect(r.tier).toBe('plus') // max(plus, starter, starter)
  })
})

// Form "de mentira" que casa com o contrato pinado (p/ testar a validação sem o banco).
function formContratoOk(): QuestionConfig[] {
  const q = MIGRACAO.q
  const base = (id: string, type: string): QuestionConfig =>
    ({ id, type, title: 't', required: true } as unknown as QuestionConfig)
  return [
    base(q.nome, 'short_text'),
    base(q.telefone, 'phone'),
    base(q.jaConta, 'yes_no'),
    { ...base(q.emailSim, 'email'), conditionalLogic: { questionId: q.jaConta, operator: 'equals', value: 'Sim' } } as unknown as QuestionConfig,
    { ...base(q.emailNao, 'email'), conditionalLogic: { questionId: q.jaConta, operator: 'equals', value: 'Não' } } as unknown as QuestionConfig,
    base(q.ferramenta, 'dropdown'),
    base(q.links, 'long_text'),
    base(q.respostasMes, 'dropdown'),
    base(q.recursos, 'checkboxes'),
    base(q.qtdForms, 'number'),
    base(q.maiorForm, 'dropdown'),
  ]
}

describe('validarContratoForm', () => {
  it('aprova um form que casa com o contrato pinado', () => {
    expect(validarContratoForm(formContratoOk()).ok).toBe(true)
  })
  it('reprova se um tipo divergir', () => {
    const qs = formContratoOk()
    qs[1] = { ...qs[1], type: 'short_text' } as unknown as QuestionConfig // telefone virou short_text
    const r = validarContratoForm(qs)
    expect(r.ok).toBe(false)
    expect(r.erros.join()).toContain('telefone')
  })
  it('reprova se a condicional do e-mail estiver errada', () => {
    const qs = formContratoOk()
    qs[3] = { ...qs[3], conditionalLogic: { questionId: MIGRACAO.q.jaConta, operator: 'equals', value: 'Não' } } as unknown as QuestionConfig
    expect(validarContratoForm(qs).ok).toBe(false)
  })
  it('reprova se faltar uma pergunta', () => {
    expect(validarContratoForm([]).ok).toBe(false)
  })
})
