/**
 * EidosForm — Conditional Logic Engine
 * Sprint Dia 3
 */

export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'greater_than'
  | 'less_than'

export interface Condition {
  questionId: string
  operator: ConditionOperator
  value: string
  goToQuestionId: string
}

export interface QuestionWithConditions {
  id: string
  order: number
  conditions?: Condition[]
  [key: string]: unknown
}

export type AnswersMap = Record<string, string | number | boolean | null>

function evaluateCondition(condition: Condition, answers: AnswersMap): boolean {
  const rawAnswer = answers[condition.questionId]
  if (rawAnswer === undefined || rawAnswer === null) return false

  const answerStr = String(rawAnswer).toLowerCase().trim()
  const condValue = String(condition.value).toLowerCase().trim()

  switch (condition.operator) {
    case 'equals':
      return answerStr === condValue
    case 'not_equals':
      return answerStr !== condValue
    case 'contains':
      return answerStr.includes(condValue)
    case 'greater_than': {
      const a = parseFloat(answerStr)
      const b = parseFloat(condValue)
      if (isNaN(a) || isNaN(b)) return false
      return a > b
    }
    case 'less_than': {
      const a = parseFloat(answerStr)
      const b = parseFloat(condValue)
      if (isNaN(a) || isNaN(b)) return false
      return a < b
    }
    default:
      return false
  }
}

/**
 * Retorna o próximo questionId com base nas condições e na ordem das perguntas.
 * Retorna null quando o formulário deve encerrar.
 */
export function getNextQuestionId(
  currentQuestionId: string,
  questions: QuestionWithConditions[],
  answers: AnswersMap,
): string | null {
  const current = questions.find((q) => q.id === currentQuestionId)
  if (!current) return null

  if (current.conditions && current.conditions.length > 0) {
    for (const condition of current.conditions) {
      if (evaluateCondition(condition, answers)) {
        const target = questions.find((q) => q.id === condition.goToQuestionId)
        if (target) return condition.goToQuestionId
      }
    }
  }

  const sorted = [...questions].sort((a, b) => a.order - b.order)
  const idx = sorted.findIndex((q) => q.id === currentQuestionId)
  if (idx === -1 || idx === sorted.length - 1) return null
  return sorted[idx + 1].id
}

/**
 * Simula o caminho de perguntas com base nas respostas fornecidas.
 */
export function buildQuestionPath(
  questions: QuestionWithConditions[],
  answers: AnswersMap,
  startQuestionId?: string,
): string[] {
  if (questions.length === 0) return []

  const sorted = [...questions].sort((a, b) => a.order - b.order)
  const firstId = startQuestionId ?? sorted[0].id

  const path: string[] = []
  const visited = new Set<string>()
  let currentId: string | null = firstId

  while (currentId !== null) {
    if (visited.has(currentId)) break
    visited.add(currentId)
    path.push(currentId)
    currentId = getNextQuestionId(currentId, questions, answers)
  }

  return path
}
