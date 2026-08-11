import { describe, it, expect } from 'vitest'
import { getVisibleQuestions, getNextQuestionId, buildQuestionPath, evaluateJumpRules, isQuestionVisible, normalizeConditional, getAdvanceControls, resolveSubmitFieldError } from './form-logic-engine'
import type { QuestionConfig, ConditionalGroup, QuestionType } from './database.types'

// Cenário: pergunta-alvo de um salto só fica visível por causa da resposta
// recém-dada (bug do salto que caía na lista de visíveis defasada).
const q = (id: string, extra: Partial<QuestionConfig> = {}): QuestionConfig =>
  ({ id, type: 'short_text', title: id, ...extra } as QuestionConfig)

describe('getVisibleQuestions', () => {
  it('revela pergunta condicional assim que a resposta-gatilho existe', () => {
    const questions = [
      q('gatilho'),
      q('alvo', { conditionalLogic: { questionId: 'gatilho', operator: 'equals', value: 'sim' } }),
    ]
    expect(getVisibleQuestions(questions, {}).map(x => x.id)).toEqual(['gatilho'])
    expect(getVisibleQuestions(questions, { gatilho: 'sim' }).map(x => x.id)).toEqual(['gatilho', 'alvo'])
  })
})

describe('salto para pergunta condicional', () => {
  const questions = [
    q('start', {
      jumpRules: [
        { id: 'r1', condition: { questionId: 'start', operator: 'equals', value: 'pular' },
          action: { type: 'jump', targetQuestionId: 'alvo' } },
      ],
    }),
    q('meio'),
    q('alvo', { conditionalLogic: { questionId: 'start', operator: 'equals', value: 'pular' } }),
  ]

  it('o alvo do salto está visível quando avaliado com a resposta-gatilho', () => {
    // contrato do qual o fix em form-player.tsx depende: a visibilidade
    // precisa ser recalculada COM a resposta nova antes de localizar o alvo.
    const answers = { start: 'pular' }
    const visible = getVisibleQuestions(questions, answers)
    expect(visible.find(x => x.id === 'alvo')).toBeDefined()
  })

  it('buildQuestionPath roteia start -> alvo, pulando "meio"', () => {
    expect(buildQuestionPath(questions, { start: 'pular' })).toEqual(['start', 'alvo'])
  })

  it('sem a resposta-gatilho o fluxo segue sequencial', () => {
    expect(getNextQuestionId('start', getVisibleQuestions(questions, {}), {})).toBe('meio')
  })
})

describe('regras incompletas (questionId/targetQuestionId vazios)', () => {
  it('condição condicional sem pergunta-base é ignorada (pergunta visível)', () => {
    const questions = [
      q('a', { conditionalLogic: { questionId: '', operator: 'equals', value: '' } }),
      q('b', { conditionalLogic: { questionId: '', operator: 'not_equals', value: 'x' } }),
    ]
    expect(getVisibleQuestions(questions, {}).map(x => x.id)).toEqual(['a', 'b'])
  })

  it('regra de salto sem pergunta-base na condição é ignorada', () => {
    const action = evaluateJumpRules(
      [{ id: 'r', condition: { questionId: '', operator: 'is_empty', value: '' },
         action: { type: 'jump', targetQuestionId: 'x' } }],
      {},
    )
    expect(action).toBeNull()
  })

  it('regra de salto sem destino é ignorada', () => {
    const action = evaluateJumpRules(
      [{ id: 'r', condition: { questionId: 'a', operator: 'equals', value: 'sim' },
         action: { type: 'jump', targetQuestionId: '' } }],
      { a: 'sim' },
    )
    expect(action).toBeNull()
  })

  it('regra de salto submit sem destino continua válida', () => {
    const action = evaluateJumpRules(
      [{ id: 'r', condition: { questionId: 'a', operator: 'is_empty', value: '' },
         action: { type: 'submit' } }],
      {},
    )
    expect(action).toEqual({ type: 'submit' })
  })
})

// Grupo de regras (formato novo) com conjunção E/OU.
const group = (conjunction: 'and' | 'or', rules: ConditionalGroup['rules']): ConditionalGroup =>
  ({ conjunction, rules })

describe('condições múltiplas (grupo E/OU)', () => {
  const ans = { idade: '30', plano: 'pro' }

  it('T1 — E: todas verdadeiras → visível', () => {
    const alvo = q('alvo', { conditionalLogic: group('and', [
      { questionId: 'idade', operator: 'greater_than', value: '18' },
      { questionId: 'plano', operator: 'equals', value: 'pro' },
    ]) })
    expect(isQuestionVisible(alvo, ans)).toBe(true)
  })

  it('T2 — E: uma verdadeira + uma falsa → oculto', () => {
    const alvo = q('alvo', { conditionalLogic: group('and', [
      { questionId: 'idade', operator: 'greater_than', value: '18' },
      { questionId: 'plano', operator: 'equals', value: 'free' },
    ]) })
    expect(isQuestionVisible(alvo, ans)).toBe(false)
  })

  it('T3 — OU: uma verdadeira + uma falsa → visível', () => {
    const alvo = q('alvo', { conditionalLogic: group('or', [
      { questionId: 'idade', operator: 'less_than', value: '18' },
      { questionId: 'plano', operator: 'equals', value: 'pro' },
    ]) })
    expect(isQuestionVisible(alvo, ans)).toBe(true)
  })

  it('T4 — OU: todas falsas → oculto', () => {
    const alvo = q('alvo', { conditionalLogic: group('or', [
      { questionId: 'idade', operator: 'less_than', value: '18' },
      { questionId: 'plano', operator: 'equals', value: 'free' },
    ]) })
    expect(isQuestionVisible(alvo, ans)).toBe(false)
  })

  it('T5 — regra incompleta ignorada num grupo E válido', () => {
    // a regra sem questionId não conta; sobra só a válida (verdadeira) → visível
    const alvo = q('alvo', { conditionalLogic: group('and', [
      { questionId: '', operator: 'equals', value: 'x' },
      { questionId: 'plano', operator: 'equals', value: 'pro' },
    ]) })
    expect(isQuestionVisible(alvo, ans)).toBe(true)
    // e se a única válida for falsa → oculto
    const alvo2 = q('alvo2', { conditionalLogic: group('and', [
      { questionId: '', operator: 'equals', value: 'x' },
      { questionId: 'plano', operator: 'equals', value: 'free' },
    ]) })
    expect(isQuestionVisible(alvo2, ans)).toBe(false)
  })

  it('T6 — todas as regras incompletas → visível', () => {
    const alvo = q('alvo', { conditionalLogic: group('and', [
      { questionId: '', operator: 'equals', value: 'x' },
      { questionId: '', operator: 'not_equals', value: 'y' },
    ]) })
    expect(isQuestionVisible(alvo, ans)).toBe(true)
    // grupo vazio também é visível
    expect(isQuestionVisible(q('vazio', { conditionalLogic: group('and', []) }), ans)).toBe(true)
  })

  it('T7 — retrocompat: regra única legada idêntica ao baseline', () => {
    const legada = q('legada', { conditionalLogic: { questionId: 'plano', operator: 'equals', value: 'pro' } })
    expect(isQuestionVisible(legada, ans)).toBe(true)
    expect(isQuestionVisible(legada, { plano: 'free' })).toBe(false)
    // o getVisibleQuestions também segue funcionando com o formato legado
    expect(getVisibleQuestions([legada], ans).map(x => x.id)).toEqual(['legada'])
    expect(getVisibleQuestions([legada], { plano: 'free' }).map(x => x.id)).toEqual([])
  })
})

describe('R7 — salto para alvo oculto por condição (T10/T11)', () => {
  const questions = [
    q('start', {
      jumpRules: [
        { id: 'r1', condition: { questionId: 'start', operator: 'equals', value: 'pular' },
          action: { type: 'jump', targetQuestionId: 'alvo' } },
      ],
    }),
    q('meio'),
    // 'alvo' só aparece se idade > 18; se não, está oculto
    q('alvo', { conditionalLogic: { questionId: 'idade', operator: 'greater_than', value: '18' } }),
    q('fim'),
  ]

  it('T10 — alvo oculto não entra no buildQuestionPath; segue sequencial', () => {
    // start manda pular pra "alvo", mas "alvo" está oculto (idade ausente) → o path
    // não pode incluir o alvo escondido; cai no próximo visível.
    const path = buildQuestionPath(questions, { start: 'pular' })
    expect(path).not.toContain('alvo')
    expect(path[0]).toBe('start')
  })

  it('T10b — quando o alvo está visível, o salto funciona normalmente', () => {
    const path = buildQuestionPath(questions, { start: 'pular', idade: '30' })
    expect(path).toContain('alvo')
  })

  it('T11 — não-regressão: lista completa, alvo existente → salta normal', () => {
    // getNextQuestionId com a lista inteira (não filtrada) e alvo presente: comportamento idêntico ao anterior
    const next = getNextQuestionId('start', questions, { start: 'pular', idade: '30' })
    expect(next).toBe('alvo')
  })

  it('T11b — alvo órfão/deletado cai no sequencial (antes retornava id inexistente)', () => {
    const orfas = [
      q('a', { jumpRules: [
        { id: 'r', condition: { questionId: 'a', operator: 'not_empty', value: '' },
          action: { type: 'jump', targetQuestionId: 'zzz' } }, // 'zzz' não existe
      ] }),
      q('b'),
    ]
    expect(getNextQuestionId('a', orfas, { a: 'x' })).toBe('b')
  })
})

describe('normalizeConditional (T8/T15)', () => {
  it('undefined/null → grupo vazio AND', () => {
    expect(normalizeConditional(undefined)).toEqual({ conjunction: 'and', rules: [] })
    expect(normalizeConditional(null)).toEqual({ conjunction: 'and', rules: [] })
  })

  it('regra única legada → grupo AND de 1 regra', () => {
    const r = { questionId: 'a', operator: 'equals' as const, value: 'x' }
    expect(normalizeConditional(r)).toEqual({ conjunction: 'and', rules: [r] })
  })

  it('grupo válido é preservado', () => {
    const g = group('or', [{ questionId: 'a', operator: 'equals', value: 'x' }])
    expect(normalizeConditional(g)).toEqual(g)
  })

  it('T15 — endurecimento: rules sem conjunction válida → AND; conjunção inválida → AND', () => {
    expect(normalizeConditional({ rules: [] } as unknown as ConditionalGroup).conjunction).toBe('and')
    const bad = { conjunction: 'xor', rules: [{ questionId: 'a', operator: 'equals', value: 'x' }] } as unknown as ConditionalGroup
    expect(normalizeConditional(bad).conjunction).toBe('and')
  })
})

/**
 * getAdvanceControls — quem manda avançar na pergunta do Calendly.
 *
 * POR QUE ISTO EXISTE, em uma frase: a caixa do Calendly tem rolagem própria e o botão
 * "Agendar Evento" DELE nasce fora da área visível no celular; o nosso "OK", não. A pessoa
 * preenche nome e e-mail dentro do Calendly e clica no NOSSO botão.
 *
 * O caso que mais dói é o da pergunta OPCIONAL: ela avança, conclui o formulário, e o dono
 * recebe um lead impecável no painel sem reunião nenhuma na agenda. Silencioso até o dia em que
 * a pessoa não aparece.
 *
 * Este bloco é a primeira cobertura automática que essa pergunta já teve. O avanço do Calendly
 * quebrou TRÊS vezes por refatoração e todas as três foram achadas por teste manual do Sidney.
 */
describe('getAdvanceControls — o Calendly toma conta do próprio avanço', () => {
  const calendly = (required: boolean) => ({ type: 'calendly' as const, required })
  const AGENDADO = { q1: { event_uri: 'https://api.calendly.com/scheduled_events/abc' } }

  it('obrigatório e sem agendamento: nenhum controle nosso avança', () => {
    expect(getAdvanceControls(calendly(true), {}, 'q1'))
      .toEqual({ pending: true, locked: true, canSkip: false })
  })

  it('opcional e sem agendamento: vira "Pular", não some', () => {
    // Sumir o botão numa pergunta opcional deixaria a pessoa sem saída se ela não quiser agendar.
    expect(getAdvanceControls(calendly(false), {}, 'q1'))
      .toEqual({ pending: true, locked: false, canSkip: true })
  })

  it('DEPOIS de agendar, tudo volta ao normal', () => {
    // Esta é a saída manual caso o avanço automático de 3s falhe. Manter travado aqui recriaria
    // o beco sem saída que foi o defeito ORIGINAL desta pergunta.
    expect(getAdvanceControls(calendly(true), AGENDADO, 'q1'))
      .toEqual({ pending: false, locked: false, canSkip: false })
  })

  it('aceita a resposta em formato legado (string)', () => {
    expect(getAdvanceControls(calendly(true), { q1: 'scheduled' }, 'q1').pending).toBe(false)
  })

  it('resposta vazia NÃO conta como agendamento', () => {
    for (const vazio of ['', null, undefined]) {
      expect(getAdvanceControls(calendly(true), { q1: vazio }, 'q1').pending).toBe(true)
    }
  })

  it('resposta de OUTRA pergunta não destrava esta', () => {
    expect(getAdvanceControls(calendly(true), { q2: AGENDADO.q1 }, 'q1').pending).toBe(true)
  })
})

describe('getAdvanceControls — nunca trava quem não é Calendly', () => {
  it('NENHUM outro tipo é afetado — os 19, obrigatórios e vazios', () => {
    // A trava é cirúrgica: se vazar para texto curto, e-mail ou telefone, o formulário inteiro
    // fica sem botão de avançar e NADA mais é preenchível. É o pior estrago possível daqui, então
    // a lista é o union INTEIRO de QuestionType menos 'calendly' — não uma amostra.
    const todosMenosCalendly: QuestionType[] = [
      'short_text', 'long_text', 'dropdown', 'select', 'checkboxes', 'email', 'phone', 'number',
      'date', 'rating', 'opinion_scale', 'yes_no', 'file_upload', 'nps', 'url', 'address', 'cpf',
      'html_block', 'content_block',
    ]
    for (const type of todosMenosCalendly) {
      expect(getAdvanceControls({ type, required: true }, {}, 'q1'))
        .toEqual({ pending: false, locked: false, canSkip: false })
    }
  })

  it('sem pergunta atual não trava nada', () => {
    expect(getAdvanceControls(null, {}, 'q1').locked).toBe(false)
    expect(getAdvanceControls(undefined, {}, 'q1').locked).toBe(false)
  })

  it('sem id da pergunta, falha ABERTO — nunca em beco sem saída', () => {
    // Não dá para saber se agendou. Travar seria pior que o defeito que esta função corrige:
    // formulário sem saída, nem recarregando.
    expect(getAdvanceControls(calendlyObrigatorio, {}, undefined))
      .toEqual({ pending: false, locked: false, canSkip: false })
  })
})

const calendlyObrigatorio = { type: 'calendly' as const, required: true }

/**
 * E06-S1-003 — o 422 tem de levar o lead ATÉ a pergunta que errou.
 *
 * O servidor sempre devolveu `field_errors` com o id; o player só mostrava o texto num aviso
 * flutuante e deixava a pessoa parada na última tela, depois de preencher o formulário inteiro.
 * É o fim do funil: quem não descobre onde consertar, desiste — e o dono nunca sabe que existiu.
 */
describe('resolveSubmitFieldError — para onde voltar quando o servidor recusa', () => {
  const visiveis = [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }]

  it('devolve a pergunta do primeiro erro visível', () => {
    const r = resolveSubmitFieldError([{ questionId: 'q2', error: 'E-mail inválido' }], visiveis)
    expect(r).toEqual({ questionId: 'q2', error: 'E-mail inválido' })
  })

  it('pula erro de pergunta INVISÍVEL e usa o próximo que dá para mostrar', () => {
    // Mandar o lead para um ramo condicional fechado seria pior que o aviso genérico.
    const r = resolveSubmitFieldError(
      [{ questionId: 'oculta', error: 'x' }, { questionId: 'q3', error: 'Telefone inválido' }],
      visiveis,
    )
    expect(r?.questionId).toBe('q3')
  })

  it('só erros invisíveis → null (o chamador cai no aviso genérico)', () => {
    expect(resolveSubmitFieldError([{ questionId: 'oculta', error: 'x' }], visiveis)).toBeNull()
  })

  it('formato inesperado do servidor nunca quebra o player', () => {
    for (const lixo of [null, undefined, 'texto', 42, {}, [{}], [{ questionId: 'q1' }], [{ error: 'só msg' }]]) {
      expect(resolveSubmitFieldError(lixo, visiveis)).toBeNull()
    }
  })

  it('lista vazia de erros → null', () => {
    expect(resolveSubmitFieldError([], visiveis)).toBeNull()
  })
})
