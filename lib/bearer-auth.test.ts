/**
 * Comparação de segredo em tempo constante (auditoria 2026-08, lote 2-bis · D10).
 *
 * O defeito: duas rotas internas comparavam com `timingSafeEqual` e OUTRAS OITO com `===` — os
 * 6 crons, o disparo de WhatsApp, `plano/lookup` e `migracao/recommend`, todas com o MESMO
 * segredo. `===` sai no primeiro caractere diferente, então o tempo de resposta vaza quantos
 * caracteres iniciais estão certos.
 *
 * Estes testes travam o CONTRATO do helper. O tempo em si não dá para testar de forma estável
 * (o ruído do agendador domina qualquer medição), então o que se garante aqui é que a função
 * aceita/recusa corretamente e nunca lança — `timingSafeEqual` LANÇA com buffers de tamanhos
 * diferentes, e foi por isso que a checagem de comprimento veio antes.
 */
import { describe, it, expect } from 'vitest'
import { isValidBearerSecret } from './bearer-auth'

const SEGREDO = 'super-secreto-1234567890'

describe('isValidBearerSecret', () => {
  it('aceita o segredo correto', () => {
    expect(isValidBearerSecret(`Bearer ${SEGREDO}`, SEGREDO)).toBe(true)
  })

  it('tolera espaços em volta do token', () => {
    expect(isValidBearerSecret(`Bearer   ${SEGREDO}  `, SEGREDO)).toBe(true)
  })

  it('recusa segredo errado do mesmo tamanho', () => {
    const errado = 'x'.repeat(SEGREDO.length)
    expect(isValidBearerSecret(`Bearer ${errado}`, SEGREDO)).toBe(false)
  })

  it('NÃO LANÇA com tamanhos diferentes — timingSafeEqual lançaria', () => {
    // É o motivo de a comparação de comprimento vir antes. Uma exceção aqui viraria 500 na
    // rota, e um 500 distinto de um 401 é, ele próprio, um oráculo.
    expect(() => isValidBearerSecret('Bearer curto', SEGREDO)).not.toThrow()
    expect(isValidBearerSecret('Bearer curto', SEGREDO)).toBe(false)
    expect(isValidBearerSecret(`Bearer ${SEGREDO}${SEGREDO}`, SEGREDO)).toBe(false)
  })

  it('recusa prefixo correto — o caso que o `===` vazava caractere a caractere', () => {
    expect(isValidBearerSecret(`Bearer ${SEGREDO.slice(0, -1)}`, SEGREDO)).toBe(false)
    expect(isValidBearerSecret(`Bearer ${SEGREDO.slice(0, 3)}`, SEGREDO)).toBe(false)
  })

  it('recusa header ausente, vazio ou sem o esquema Bearer', () => {
    expect(isValidBearerSecret(null, SEGREDO)).toBe(false)
    expect(isValidBearerSecret('', SEGREDO)).toBe(false)
    expect(isValidBearerSecret(SEGREDO, SEGREDO)).toBe(false)
    expect(isValidBearerSecret(`Basic ${SEGREDO}`, SEGREDO)).toBe(false)
    expect(isValidBearerSecret(`bearer ${SEGREDO}`, SEGREDO)).toBe(false)
  })

  it('FAIL-CLOSED: segredo não configurado recusa TUDO, inclusive header vazio', () => {
    // Sem isto, um ambiente sem a env var aceitaria `Bearer ` como válido — porta escancarada
    // exatamente onde o segredo deveria proteger.
    expect(isValidBearerSecret('Bearer qualquer', undefined)).toBe(false)
    expect(isValidBearerSecret('Bearer qualquer', '')).toBe(false)
    expect(isValidBearerSecret('Bearer ', '')).toBe(false)
    expect(isValidBearerSecret('Bearer ', undefined)).toBe(false)
  })
})
