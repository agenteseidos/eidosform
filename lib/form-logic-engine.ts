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
    return jumpAction.targetQuestionId
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
