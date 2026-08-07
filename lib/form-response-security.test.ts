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

/**
 * Bloco de conteúdo marcado como OBRIGATÓRIO (auditoria 2026-08, lote 5).
 *
 * `html_block` e `content_block` são as duas formas de bloco que só EXIBEM conteúdo — nenhum dos
 * dois recebe resposta. Só `content_block` estava excluído da checagem de obrigatoriedade, então
 * um `html_block` com o toggle "obrigatório" ligado deixava a resposta eternamente incompleta.
 *
 * E "incompleta" não é um detalhe cosmético: é o PORTÃO ÚNICO de e-mail ao dono, WhatsApp, Google
 * Sheets, pixel da Meta e webhook do cliente (`app/api/responses/route.ts:625`). Um clique num
 * toggle da barra lateral desligava a captação inteira daquele formulário, em silêncio, e nem
 * recarregar a página resolvia.
 */
describe('isResponseComplete × bloco de conteúdo obrigatório (lote 5)', () => {
  const resposta = { p1: 'João' }

  it('html_block obrigatório NÃO impede a resposta de ser completa', () => {
    const questions = [
      { id: 'p1', type: 'short_text', required: true },
      { id: 'b1', type: 'html_block', required: true },
    ]
    expect(isResponseComplete(resposta, questions)).toBe(true)
  })

  it('content_block obrigatório continua não impedindo (comportamento que já existia)', () => {
    const questions = [
      { id: 'p1', type: 'short_text', required: true },
      { id: 'b1', type: 'content_block', required: true },
    ]
    expect(isResponseComplete(resposta, questions)).toBe(true)
  })

  it('os dois blocos juntos, ambos obrigatórios, ainda deixam completar', () => {
    const questions = [
      { id: 'p1', type: 'short_text', required: true },
      { id: 'b1', type: 'html_block', required: true },
      { id: 'b2', type: 'content_block', required: true },
    ]
    expect(isResponseComplete(resposta, questions)).toBe(true)
  })

  it('REGRESSÃO: pergunta de verdade obrigatória e vazia continua reprovando', () => {
    // O risco da correção é afrouxar demais e passar a considerar completa uma resposta que
    // deixou pergunta obrigatória em branco — aí o dono recebe lead sem o dado que ele exigiu.
    const questions = [
      { id: 'p1', type: 'short_text', required: true },
      { id: 'p2', type: 'email', required: true },
      { id: 'b1', type: 'html_block', required: true },
    ]
    expect(isResponseComplete(resposta, questions)).toBe(false)
  })

  it('formulário SÓ com blocos obrigatórios é completo (não há nada para responder)', () => {
    const questions = [
      { id: 'b1', type: 'html_block', required: true },
      { id: 'b2', type: 'content_block', required: true },
    ]
    expect(isResponseComplete({}, questions)).toBe(true)
  })
})
