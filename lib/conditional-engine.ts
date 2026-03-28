/**
 * EidosForm — Conditional Logic Engine
 * Sprint Dia 3
 */

import { QuestionConfig } from '@/lib/database.types'
import {
  buildQuestionPath as buildQuestionPathWithEngine,
  getNextQuestionId as getNextQuestionIdWithEngine,
} from '@/lib/form-logic-engine'

export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'greater_than'
  | 'less_than'
  | 'not_empty'
  | 'is_empty'

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

function toQuestionConfigs(questions: QuestionWithConditions[]): QuestionConfig[] {
  return [...questions]
    .sort((a, b) => a.order - b.order)
    .map((question) => ({
      ...(question as unknown as QuestionConfig),
      jumpRules: (question.conditions || []).map((condition) => ({
        id: `${question.id}:${condition.questionId}:${condition.goToQuestionId}`,
        condition: {
          questionId: condition.questionId,
          operator: condition.operator,
          value: condition.value,
        },
        action: {
          type: 'jump' as const,
          targetQuestionId: condition.goToQuestionId,
        },
      })),
    }))
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
  return getNextQuestionIdWithEngine(currentQuestionId, toQuestionConfigs(questions), answers)
}

/**
 * Simula o caminho de perguntas com base nas respostas fornecidas.
 */
export function buildQuestionPath(
  questions: QuestionWithConditions[],
  answers: AnswersMap,
  startQuestionId?: string,
): string[] {
  return buildQuestionPathWithEngine(toQuestionConfigs(questions), answers, startQuestionId)
}
