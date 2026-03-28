// Jump Logic — lógica condicional de navegação entre perguntas

import { evaluateJumpRules as evaluateJumpRulesWithEngine } from '@/lib/form-logic-engine'

export interface JumpRule {
  id: string
  condition: {
    questionId: string
    operator:
      | 'equals'
      | 'not_equals'
      | 'contains'
      | 'greater_than'
      | 'less_than'
      | 'not_empty'
      | 'is_empty'
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
  { value: 'not_empty', label: 'não está vazio' },
  { value: 'is_empty', label: 'está vazio' },
] as const

/**
 * Avalia as jump rules de uma pergunta e retorna a ação da primeira regra que bater.
 */
export function evaluateJumpRules(
  rules: JumpRule[],
  _currentQuestionId: string,
  answers: Record<string, unknown>
): JumpRule['action'] | null {
  return evaluateJumpRulesWithEngine(rules, answers)
}
