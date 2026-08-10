import { ConditionalRule, ConditionalGroup, QuestionConfig } from '@/lib/database.types'
import type { JumpRule } from '@/lib/jump-logic'

export type LogicOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'greater_than'
  | 'less_than'
  | 'not_empty'
  | 'is_empty'

export type LogicAnswersMap = Record<string, unknown>

interface EvaluatableRule {
  questionId: string
  operator: LogicOperator
  value?: string
}

function normalizeAnswer(answer: unknown): string {
  if (Array.isArray(answer)) return answer.map((item) => String(item ?? '')).join(', ')
  if (answer === undefined || answer === null) return ''
  return String(answer)
}

export function evaluateLogicRule(rule: EvaluatableRule, answers: LogicAnswersMap): boolean {
  const answer = normalizeAnswer(answers[rule.questionId]).trim()
  const answerLower = answer.toLowerCase()
  const value = String(rule.value ?? '').trim()
  const valueLower = value.toLowerCase()

  switch (rule.operator) {
    case 'is_empty':
      return answer.length === 0
    case 'not_empty':
      return answer.length > 0
    case 'equals':
      return answerLower === valueLower
    case 'not_equals':
      return answerLower !== valueLower
    case 'contains':
      return answerLower.includes(valueLower)
    case 'greater_than': {
      const answerNumber = parseFloat(answer)
      const valueNumber = parseFloat(value)
      return !Number.isNaN(answerNumber) && !Number.isNaN(valueNumber) && answerNumber > valueNumber
    }
    case 'less_than': {
      const answerNumber = parseFloat(answer)
      const valueNumber = parseFloat(value)
      return !Number.isNaN(answerNumber) && !Number.isNaN(valueNumber) && answerNumber < valueNumber
    }
    default:
      return false
  }
}

// Converte o formato legado (ConditionalRule única) e o novo (ConditionalGroup)
// para um grupo canônico. Discrimina por Array.isArray(rules) — não por 'rules' in raw
// — porque o dado vem do JSONB sem validação na leitura do motor: um objeto malformado
// com chave `rules` mas sem `conjunction` seria tratado como grupo de outra forma.
// Conjunção inválida cai para 'and'.
export function normalizeConditional(
  raw: ConditionalRule | ConditionalGroup | null | undefined,
): ConditionalGroup {
  if (!raw) return { conjunction: 'and', rules: [] }
  if (Array.isArray((raw as ConditionalGroup).rules)) {
    const group = raw as ConditionalGroup
    return { conjunction: group.conjunction === 'or' ? 'or' : 'and', rules: group.rules }
  }
  return { conjunction: 'and', rules: [raw as ConditionalRule] }
}

export function isQuestionVisible(question: QuestionConfig, answers: LogicAnswersMap): boolean {
  const group = normalizeConditional(question.conditionalLogic)
  // Ignora regras incompletas (pergunta-base não escolhida no editor): avaliá-las
  // contra um id vazio faria o bloco sumir/aparecer sem querer. Se TODAS forem
  // incompletas, não há condição efetiva → mantém visível (igual ao comportamento legado).
  const valid = group.rules.filter((r) => r && r.questionId)
  if (valid.length === 0) return true
  return group.conjunction === 'or'
    ? valid.some((r) => evaluateLogicRule(r, answers))
    : valid.every((r) => evaluateLogicRule(r, answers))
}

export function getVisibleQuestions(questions: QuestionConfig[], answers: LogicAnswersMap): QuestionConfig[] {
  return questions.filter((question) => isQuestionVisible(question, answers))
}

export function evaluateJumpRules(rules: JumpRule[], answers: LogicAnswersMap): JumpRule['action'] | null {
  for (const rule of rules) {
    // Ignora regras incompletas: sem pergunta-base na condição, ou salto sem
    // destino escolhido. Avaliá-las consumiria o fluxo de forma imprevisível.
    if (!rule.condition?.questionId) continue
    if (rule.action?.type === 'jump' && !rule.action.targetQuestionId) continue
    if (evaluateLogicRule(rule.condition, answers)) {
      return rule.action
    }
  }

  return null
}

export function getNextQuestionId(
  currentQuestionId: string,
  questions: Array<Pick<QuestionConfig, 'id' | 'jumpRules'>>,
  answers: LogicAnswersMap,
): string | null {
  const currentQuestion = questions.find((question) => question.id === currentQuestionId)
  if (!currentQuestion) return null

  const jumpAction = currentQuestion.jumpRules?.length
    ? evaluateJumpRules(currentQuestion.jumpRules, answers)
    : null

  if (jumpAction?.type === 'submit') return null
  if (jumpAction?.type === 'jump' && jumpAction.targetQuestionId) {
    // Só salta se o alvo está na lista recebida. Em buildQuestionPath a lista já vem
    // filtrada por visibilidade, então um alvo escondido por condição cai no sequencial
    // (não some o fluxo nem encerra o form). Com lista completa o alvo existe → idêntico
    // ao comportamento anterior (exceto alvo órfão/deletado, que passa a cair no sequencial).
    if (questions.some((question) => question.id === jumpAction.targetQuestionId)) {
      return jumpAction.targetQuestionId
    }
  }

  const currentIndex = questions.findIndex((question) => question.id === currentQuestionId)
  if (currentIndex === -1 || currentIndex === questions.length - 1) return null

  return questions[currentIndex + 1].id
}

export function buildQuestionPath(
  questions: QuestionConfig[],
  answers: LogicAnswersMap,
  startQuestionId?: string,
): string[] {
  const visibleQuestions = getVisibleQuestions(questions, answers)
  if (visibleQuestions.length === 0) return []

  const firstQuestionId = startQuestionId ?? visibleQuestions[0].id
  const path: string[] = []
  const visited = new Set<string>()
  let currentQuestionId: string | null = firstQuestionId

  while (currentQuestionId) {
    if (visited.has(currentQuestionId)) break
    visited.add(currentQuestionId)
    path.push(currentQuestionId)
    currentQuestionId = getNextQuestionId(currentQuestionId, visibleQuestions, answers)
  }

  return path
}

export function evaluateConditionalRule(rule: ConditionalRule, answers: LogicAnswersMap): boolean {
  return evaluateLogicRule(rule, answers)
}

/** Estado dos controles genéricos de avanço (botão, setinha do rodapé, Enter e seta ↓). */
export type AdvanceControls = {
  /** Pergunta cujo avanço pertence ao próprio componente, e ainda sem resposta. */
  pending: boolean
  /** Nenhum controle nosso avança: só o botão de dentro da pergunta. */
  locked: boolean
  /** O botão principal vira um "Pular" discreto, em vez de sumir. */
  canSkip: boolean
}

/**
 * Quem manda avançar na pergunta atual — nós ou a própria pergunta.
 *
 * HOJE SÓ O CALENDLY ENTRA AQUI, e o motivo é concreto (visto no celular do Sidney em
 * 10/08/2026): a caixa do Calendly tem rolagem própria e o botão "Agendar Evento" DELE nasce
 * fora da área visível; o nosso "OK", não. A pessoa preenche nome e e-mail dentro do Calendly e
 * clica no NOSSO botão.
 *
 * Obrigatória, ela leva "Este campo é obrigatório" tendo acabado de preencher os campos — parece
 * defeito, e parte das pessoas desiste. **Opcional é pior:** ela avança, termina o formulário, e
 * o dono recebe um lead impecável no painel SEM reunião nenhuma na agenda. Ninguém descobre até
 * o dia em que a pessoa não aparece.
 *
 * ⚠️ A trava vale só ENQUANTO não há resposta. Depois de agendar, tudo volta ao normal — isso é
 * a saída manual caso o avanço automático de 3 segundos falhe. Sem ela, uma falha lá viraria beco
 * sem saída, que foi exatamente o defeito original desta pergunta.
 *
 * Esta função existe separada do componente porque o avanço do Calendly já foi quebrado TRÊS
 * vezes por refatoração e não existe teste de componente React neste repositório. Aqui a regra
 * fica coberta por teste de verdade.
 */
export function getAdvanceControls(
  question: Pick<QuestionConfig, 'type' | 'required'> | null | undefined,
  answers: LogicAnswersMap,
  questionId?: string,
): AdvanceControls {
  const PARADO = { pending: false, locked: false, canSkip: false }
  if (!question || question.type !== 'calendly') return PARADO

  // Sem id não dá para saber se já agendou — e travar quem não se sabe é o pior dos dois erros:
  // vira formulário sem saída, nem recarregando. Deixar os controles normais é, no máximo, voltar
  // ao comportamento de antes desta mudança. Caminho inalcançável na prática (a pergunta atual
  // sempre tem id); a escolha está escrita porque a direção da falha importa.
  if (!questionId) return PARADO

  const answer = answers?.[questionId]
  // Resposta do Calendly é objeto (`{ event_uri }`) ou string legada. Qualquer valor com conteúdo
  // conta como agendado; `''`/`null`/`undefined` não.
  if (answer !== undefined && answer !== null && answer !== '') return PARADO

  return { pending: true, locked: !!question.required, canSkip: !question.required }
}
