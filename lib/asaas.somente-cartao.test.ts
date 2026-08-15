/**
 * lib/asaas.somente-cartao.test.ts — o EidosForm vende SÓ por cartão.
 *
 * Decisão de 10/06/2026, reafirmada pelo Sidney em 15/08 sem margem: "não vamos ter pix ou
 * boleto. se tiver isso em algum lugar, remova. só cartão."
 *
 * Este teste não olha texto — olha o que o código é CAPAZ de criar. Um `billingType` frouxo em
 * qualquer criação de cobrança abriria um meio de pagamento que o produto não suporta: o cliente
 * pagaria por um caminho que a nossa reconciliação, a régua de cobrança e o alinhamento de
 * cartão não sabem tratar.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const FONTES = ['lib/asaas.ts', 'lib/plan-switch.ts', 'app/api/checkout/[plan]/route.ts']

function codigoSemComentarios(rel: string): string {
  const bruto = readFileSync(resolve(process.cwd(), rel), 'utf8')
  return bruto
    .replace(/\/\*[\s\S]*?\*\//g, '')  // blocos
    .replace(/^\s*\/\/.*$/gm, '')      // linhas
}

describe('🛡️ só CARTÃO — nenhum caminho cria cobrança em Pix ou boleto', () => {
  it.each(FONTES)('%s: todo billingType declarado é CREDIT_CARD', (rel) => {
    const codigo = codigoSemComentarios(rel)
    const declarados = [...codigo.matchAll(/billingTypes?\s*:\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/g)]
      .map((m) => m[1])
    for (const valor of declarados) {
      expect(valor).toContain('CREDIT_CARD')
      expect(valor).not.toMatch(/PIX|BOLETO|UNDEFINED/i)
    }
  })

  it.each(FONTES)('%s: as palavras PIX/BOLETO não aparecem no código executável', (rel) => {
    // Comentário pode explicar a decisão; código, não. (Dois comentários já afirmaram que a
    // página de fatura aceitava Pix — sem evidência — e isso dirigiu uma proposta de teste errada.)
    expect(codigoSemComentarios(rel)).not.toMatch(/\bPIX\b|\bBOLETO\b/i)
  })
})
