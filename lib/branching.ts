// Projeção entre "para onde vai cada resposta" (UI da Ramificação) e as
// `jumpRules` que o motor de fato usa. Funções puras — testáveis isoladas.

import { JumpRule } from '@/lib/jump-logic'
import { QuestionConfig } from '@/lib/database.types'

/** Destino especial: seguir para a próxima pergunta (= ausência de regra). */
export const DEST_NEXT = '__next__'
/** Destino especial: encerrar o formulário. */
export const DEST_SUBMIT = '__submit__'
/** Um destino é DEST_NEXT, DEST_SUBMIT ou o id de uma pergunta. */
export type Destination = string

export function genId(): string {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Tipos cuja ramificação é editada resposta-a-resposta. */
export function isChoiceType(type: string): boolean {
  return type === 'yes_no' || type === 'dropdown' || type === 'checkboxes'
}

/** As respostas possíveis de uma pergunta de escolha. */
export function answerOptions(q: QuestionConfig): string[] {
  if (q.type === 'yes_no') return ['Sim', 'Não']
  if (q.type === 'dropdown' || q.type === 'checkboxes') return q.options ?? []
  return []
}

/** Operador usado para casar uma resposta de escolha com uma regra. */
function choiceOperator(q: QuestionConfig): 'equals' | 'contains' {
  return q.type === 'checkboxes' ? 'contains' : 'equals'
}

function actionToDest(action: JumpRule['action']): Destination {
  if (action?.type === 'submit') return DEST_SUBMIT
  return action?.targetQuestionId || DEST_NEXT
}

function destToAction(dest: Destination): JumpRule['action'] | null {
  if (dest === DEST_NEXT) return null
  if (dest === DEST_SUBMIT) return { type: 'submit' }
  return { type: 'jump', targetQuestionId: dest }
}

/** Destino atual de uma resposta de escolha (procura a regra pelo valor). */
export function getAnswerDestination(rules: JumpRule[], answer: string): Destination {
  const r = rules.find(x => x.condition?.value === answer)
  return r ? actionToDest(r.action) : DEST_NEXT
}

/**
 * Define o destino de uma resposta de escolha. Devolve o novo array de regras:
 * - DEST_NEXT  → remove a regra daquela resposta (cai no caminho padrão)
 * - DEST_SUBMIT/id → cria ou atualiza a regra correspondente
 */
export function setAnswerDestination(
  rules: JumpRule[], question: QuestionConfig, answer: string, dest: Destination,
): JumpRule[] {
  const action = destToAction(dest)
  const idx = rules.findIndex(x => x.condition?.value === answer)
  if (!action) {
    return idx === -1 ? rules : rules.filter((_, i) => i !== idx)
  }
  if (idx === -1) {
    const rule: JumpRule = {
      id: genId(),
      condition: { questionId: question.id, operator: choiceOperator(question), value: answer },
      action,
    }
    return [...rules, rule]
  }
  return rules.map((r, i) => (i === idx ? { ...r, action } : r))
}

/** Regras que não correspondem a nenhuma opção atual (avançadas/órfãs). */
export function unhandledRules(rules: JumpRule[], question: QuestionConfig): JumpRule[] {
  const opts = new Set(answerOptions(question))
  return rules.filter(r => !opts.has(r.condition?.value ?? ''))
}

// ── Blocos de conteúdo: um único destino "depois deste bloco" ──────────────

/** Destino atual de um bloco de conteúdo. */
export function getBlockDestination(rules: JumpRule[]): Destination {
  const r = rules[0]
  return r ? actionToDest(r.action) : DEST_NEXT
}

/** Define o destino de um bloco de conteúdo (regra única is_empty → ação). */
export function setBlockDestination(
  rules: JumpRule[], block: QuestionConfig, dest: Destination,
): JumpRule[] {
  const action = destToAction(dest)
  if (!action) return []
  return [{
    id: rules[0]?.id ?? genId(),
    condition: { questionId: block.id, operator: 'is_empty', value: '' },
    action,
  }]
}
