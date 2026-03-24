// Jump Logic — lógica condicional de navegação entre perguntas

export interface JumpRule {
  id: string
  condition: {
    questionId: string
    operator: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than'
    value: string
  }
  action: {
    type: 'jump' | 'submit'
    targetQuestionId?: string
  }
}

export const JUMP_OPERATORS = [
  { value: 'equals', label: 'é igual a' },
  { value: 'not_equals', label: 'é diferente de' },
  { value: 'contains', label: 'contém' },
  { value: 'greater_than', label: 'é maior que' },
  { value: 'less_than', label: 'é menor que' },
] as const

function evaluateCondition(
  condition: JumpRule['condition'],
  answerValue: string
): boolean {
  const { operator, value } = condition
  const answer = answerValue ?? ''

  switch (operator) {
    case 'equals':
      return answer.toLowerCase() === value.toLowerCase()
    case 'not_equals':
      return answer.toLowerCase() !== value.toLowerCase()
    case 'contains':
      return answer.toLowerCase().includes(value.toLowerCase())
    case 'greater_than':
      return parseFloat(answer) > parseFloat(value)
    case 'less_than':
      return parseFloat(answer) < parseFloat(value)
    default:
      return false
  }
}

/**
 * Avalia as jump rules de uma pergunta e retorna a ação da primeira regra que bater.
 */
export function evaluateJumpRules(
  rules: JumpRule[],
  currentQuestionId: string,
  answers: Record<string, unknown>
): JumpRule['action'] | null {
  for (const rule of rules) {
    const targetAnswer = String(answers[rule.condition.questionId] ?? '')
    const match = evaluateCondition(rule.condition, targetAnswer)
    if (match) return rule.action
  }
  return null
}
