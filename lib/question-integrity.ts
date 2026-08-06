// Operações estruturais sobre perguntas que precisam preservar a integridade
// da lógica (saltos, exibição condicional, eventos de pixel):
// - duplicar uma pergunta sem que a cópia continue lendo a resposta da original;
// - excluir uma pergunta limpando as regras de outras perguntas que a referenciam.

import { QuestionConfig } from '@/lib/database.types'
import { normalizeConditional } from '@/lib/form-logic-engine'
import type { AnswerSetEvent } from '@/types/pixel-events'

const newId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`

const deepCopy = <T,>(value: T): T =>
  typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value))

/**
 * Clona uma pergunta para duplicação: cópia profunda (nada compartilhado com a
 * original), ID novo para a pergunta e para cada regra, e condições de salto
 * que apontavam para a própria pergunta re-apontadas para o ID novo — senão a
 * cópia decide a rota pela RESPOSTA DA ORIGINAL.
 */
export function cloneQuestionDeep(source: QuestionConfig): QuestionConfig {
  const clone = deepCopy(source)
  const cloneId = newId()
  clone.id = cloneId
  if (clone.jumpRules?.length) {
    clone.jumpRules = clone.jumpRules.map(rule => ({
      ...rule,
      id: newId(),
      condition: {
        ...rule.condition,
        questionId: rule.condition?.questionId === source.id ? cloneId : rule.condition?.questionId,
      },
    }))
  }
  if (clone.pixelEvents?.length) {
    clone.pixelEvents = clone.pixelEvents.map(rule => ({ ...rule, id: newId() }))
  }
  return clone
}

export interface QuestionReferences {
  /** Regras de salto de outras perguntas cujo DESTINO é esta pergunta. */
  jumpTargets: number
  /** Regras de salto de outras perguntas cuja CONDIÇÃO lê esta pergunta. */
  jumpConditions: number
  /** Condições de exibição de outras perguntas que dependem desta. */
  visibilityConditions: number
  total: number
}

/** Conta quantas regras de OUTRAS perguntas referenciam a pergunta `id`. */
export function countQuestionReferences(questions: QuestionConfig[], id: string): QuestionReferences {
  let jumpTargets = 0
  let jumpConditions = 0
  let visibilityConditions = 0
  for (const q of questions) {
    if (q.id === id) continue
    for (const rule of q.jumpRules ?? []) {
      if (rule.action?.type === 'jump' && rule.action.targetQuestionId === id) jumpTargets++
      if (rule.condition?.questionId === id) jumpConditions++
    }
    const group = normalizeConditional(q.conditionalLogic)
    for (const rule of group.rules) {
      if (rule?.questionId === id) visibilityConditions++
    }
  }
  return { jumpTargets, jumpConditions, visibilityConditions, total: jumpTargets + jumpConditions + visibilityConditions }
}

/**
 * Remove a pergunta `id` e limpa as referências órfãs nas demais:
 * regras de salto que apontavam para ela (destino ou condição) são removidas;
 * condições de exibição que dependiam dela são retiradas do grupo (grupo vazio
 * limpa a condição inteira — pergunta volta a aparecer sempre).
 */
export function removeQuestionAndReferences(questions: QuestionConfig[], id: string): QuestionConfig[] {
  return questions
    .filter(q => q.id !== id)
    .map(q => {
      let next = q
      if (next.jumpRules?.length) {
        const kept = next.jumpRules.filter(rule =>
          !(rule.action?.type === 'jump' && rule.action.targetQuestionId === id) &&
          rule.condition?.questionId !== id,
        )
        if (kept.length !== next.jumpRules.length) next = { ...next, jumpRules: kept }
      }
      if (next.conditionalLogic) {
        const group = normalizeConditional(next.conditionalLogic)
        const kept = group.rules.filter(rule => rule?.questionId !== id)
        if (kept.length !== group.rules.length) {
          next = { ...next, conditionalLogic: kept.length ? { ...group, rules: kept } : undefined }
        }
      }
      return next
    })
}

/** Conta condições de eventos por conjunto (pixels.answerSetEvents) que leem a pergunta `id`. */
export function countAnswerSetReferences(events: AnswerSetEvent[] | null | undefined, id: string): number {
  let count = 0
  for (const ev of events || []) {
    for (const c of ev.conditions || []) {
      if (c.questionId === id) count++
    }
  }
  return count
}

/**
 * Remove das condições de eventos por conjunto as que leem a pergunta excluída.
 * Evento que fica sem nenhuma condição é removido inteiro (nunca casaria de
 * forma significativa); `minMatches` é re-clampado ao novo total de condições.
 */
export function removeAnswerSetReferences(events: AnswerSetEvent[] | null | undefined, id: string): AnswerSetEvent[] | undefined {
  const next: AnswerSetEvent[] = []
  for (const ev of events || []) {
    const conditions = (ev.conditions || []).filter(c => c.questionId !== id)
    if (conditions.length === 0) continue
    next.push({
      ...ev,
      conditions,
      ...(ev.match === 'at_least'
        ? { minMatches: Math.min(Math.max(1, ev.minMatches ?? 1), conditions.length) }
        : {}),
    })
  }
  return next.length > 0 ? next : undefined
}
