import { describe, it, expect } from 'vitest'
import { QuestionSchema } from './form-schema'

// T12 — conditionalLogic aceita o formato legado (regra única) e o novo (grupo),
// e rejeita grupo acima do limite de regras.
const base = { id: 'q1', type: 'short_text' as const, title: 'Q' }

describe('conditionalLogic no QuestionSchema (T12)', () => {
  it('aceita o formato legado (regra única)', () => {
    const r = QuestionSchema.safeParse({
      ...base,
      conditionalLogic: { questionId: 'a', operator: 'equals', value: 'x' },
    })
    expect(r.success).toBe(true)
  })

  it('aceita o formato novo (grupo E/OU)', () => {
    const r = QuestionSchema.safeParse({
      ...base,
      conditionalLogic: {
        conjunction: 'and',
        rules: [
          { questionId: 'a', operator: 'equals', value: 'x' },
          { questionId: 'b', operator: 'not_empty' },
        ],
      },
    })
    expect(r.success).toBe(true)
  })

  it('rejeita grupo com mais de 20 regras', () => {
    const rules = Array.from({ length: 21 }, (_, i) => ({ questionId: `q${i}`, operator: 'equals' as const, value: 'x' }))
    const r = QuestionSchema.safeParse({ ...base, conditionalLogic: { conjunction: 'or', rules } })
    expect(r.success).toBe(false)
  })

  it('rejeita conjunção inválida', () => {
    const r = QuestionSchema.safeParse({
      ...base,
      conditionalLogic: { conjunction: 'xor', rules: [{ questionId: 'a', operator: 'equals', value: 'x' }] },
    })
    expect(r.success).toBe(false)
  })
})
