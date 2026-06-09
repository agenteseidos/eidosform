import { describe, it, expect } from 'vitest'
import { isResponseComplete } from './form-response-security'

// T14 — o cálculo de `completed` respeita o fix do R7: uma pergunta obrigatória que
// é alvo de salto MAS está oculta por condição não deve bloquear a conclusão da resposta
// (o respondente terminou o sub-fluxo dele). Cobre o endpoint v1 (que usa este helper).
describe('isResponseComplete × salto para alvo oculto (T14)', () => {
  const questions = [
    { id: 'start', type: 'yes_no', required: true,
      jumpRules: [{ id: 'r', condition: { questionId: 'start', operator: 'equals', value: 'pular' },
        action: { type: 'jump', targetQuestionId: 'alvo' } }] },
    { id: 'alvo', type: 'short_text', required: true,
      conditionalLogic: { questionId: 'idade', operator: 'greater_than', value: '18' } },
    { id: 'fim', type: 'short_text', required: true },
  ]

  it('alvo oculto (idade ausente) não é exigido → resposta completa', () => {
    // start='pular' aponta p/ alvo, mas alvo está oculto (sem idade) → fora do caminho;
    // exigir alvo marcaria como incompleta uma resposta que terminou o fluxo.
    const complete = isResponseComplete(
      { start: 'pular', fim: 'ok' },
      questions as unknown as Array<{ id: string; type?: string; required?: boolean }>,
    )
    expect(complete).toBe(true)
  })

  it('alvo visível (idade > 18) e não respondido → resposta incompleta', () => {
    const complete = isResponseComplete(
      { start: 'pular', idade: '30', fim: 'ok' },
      questions as unknown as Array<{ id: string; type?: string; required?: boolean }>,
    )
    expect(complete).toBe(false)
  })
})
