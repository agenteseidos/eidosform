import { ConditionalRule, QuestionConfig } from '@/lib/database.types'
import { JumpRule } from '@/lib/jump-logic'

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

export function isQuestionVisible(question: QuestionConfig, answers: LogicAnswersMap): boolean {
  return question.conditionalLogic ? evaluateLogicRule(question.conditionalLogic, answers) : true
}

export function getVisibleQuestions(questions: QuestionConfig[], answers: LogicAnswersMap): QuestionConfig[] {
  return questions.filter((question) => isQuestionVisible(question, answers))
}

export function evaluateJumpRules(rules: JumpRule[], answers: LogicAnswersMap): JumpRule['action'] | null {
  for (const rule of rules) {
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
