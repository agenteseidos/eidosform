/**
 * D-01 · token do link de pagamento — ele guarda a porta de uma página que mostra nome, valor e
 * dados de cobrança do cliente. Um token frouxo aqui é vazamento de dado de pagamento.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { signPaymentLinkToken, verifyPaymentLinkToken } from './payment-link-token'

const AGORA = Date.parse('2026-08-12T12:00:00Z')
const PERFIL = '9f1c2a44-0f0e-4a1b-9c3d-1122334455aa'

beforeEach(() => {
  process.env.PAYMENT_LINK_TOKEN_SECRET = 'segredo-de-teste-com-tamanho-decente'
})

describe('ida e volta', () => {
  it('assina e valida, devolvendo o perfil', () => {
    const t = signPaymentLinkToken(PERFIL, AGORA)!
    expect(verifyPaymentLinkToken(t, AGORA + 1000)).toBe(PERFIL)
  })

  it('o token viaja em URL sem precisar de encoding', () => {
    const t = signPaymentLinkToken(PERFIL, AGORA)!
    expect(t).toMatch(/^[A-Za-z0-9_.-]+$/)
    expect(encodeURIComponent(t)).toBe(t)
  })
})

describe('🛡️ o que NÃO pode passar', () => {
  it('token adulterado no corpo (trocar o perfil) é recusado', () => {
    const t = signPaymentLinkToken(PERFIL, AGORA)!
    const [, assinatura] = t.split('.')
    const outroCorpo = Buffer.from(`outro-perfil.${AGORA + 999999}`, 'utf8').toString('base64url')
    expect(verifyPaymentLinkToken(`${outroCorpo}.${assinatura}`, AGORA)).toBeNull()
  })

  it('assinatura trocada é recusada', () => {
    const t = signPaymentLinkToken(PERFIL, AGORA)!
    const [corpo] = t.split('.')
    expect(verifyPaymentLinkToken(`${corpo}.assinaturafalsa`, AGORA)).toBeNull()
  })

  it('token assinado com OUTRO segredo é recusado', () => {
    const t = signPaymentLinkToken(PERFIL, AGORA)!
    process.env.PAYMENT_LINK_TOKEN_SECRET = 'outro-segredo-completamente-diferente'
    expect(verifyPaymentLinkToken(t, AGORA)).toBeNull()
  })

  it('lixo e formatos inesperados nunca quebram nem passam', () => {
    for (const ruim of ['', 'abc', 'a.b.c', '.', null, undefined, 'x'.repeat(500)]) {
      expect(verifyPaymentLinkToken(ruim as string | null, AGORA)).toBeNull()
    }
  })

  it('sem segredo configurado: não assina e não valida (falha fechada)', () => {
    delete process.env.PAYMENT_LINK_TOKEN_SECRET
    delete process.env.INTERNAL_API_SECRET
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(signPaymentLinkToken(PERFIL, AGORA)).toBeNull()
    expect(verifyPaymentLinkToken('qualquer.coisa', AGORA)).toBeNull()
  })
})

describe('🛡️ prazo de validade', () => {
  it('vale por 15 dias — 3× a régua, com folga para quem abre depois', () => {
    const t = signPaymentLinkToken(PERFIL, AGORA)!
    expect(verifyPaymentLinkToken(t, AGORA + 14 * 86_400_000)).toBe(PERFIL)
  })

  it('expira depois disso', () => {
    const t = signPaymentLinkToken(PERFIL, AGORA)!
    expect(verifyPaymentLinkToken(t, AGORA + 16 * 86_400_000)).toBeNull()
  })

  it('no instante exato do vencimento já não vale', () => {
    const t = signPaymentLinkToken(PERFIL, AGORA)!
    expect(verifyPaymentLinkToken(t, AGORA + 15 * 86_400_000)).toBeNull()
  })
})

describe('🛡️ o segredo é DEDICADO — sem cadeia de fallback (S3, auditoria 14/08)', () => {
  it('sem PAYMENT_LINK_TOKEN_SECRET não assina, mesmo com os segredos legados presentes', () => {
    // O teste antigo removia os três juntos, então não travava a SEPARAÇÃO: voltar o fallback
    // para INTERNAL_API_SECRET seguia verde. Aqui os legados existem de propósito.
    const salvos = {
      dedicado: process.env.PAYMENT_LINK_TOKEN_SECRET,
      interno: process.env.INTERNAL_API_SECRET,
      service: process.env.SUPABASE_SERVICE_ROLE_KEY,
    }
    try {
      delete process.env.PAYMENT_LINK_TOKEN_SECRET
      process.env.INTERNAL_API_SECRET = 'segredo-interno-que-NAO-deve-assinar-link'
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-que-NAO-deve-assinar-link'

      expect(signPaymentLinkToken('11111111-1111-4111-8111-111111111111')).toBeNull()
    } finally {
      if (salvos.dedicado === undefined) delete process.env.PAYMENT_LINK_TOKEN_SECRET
      else process.env.PAYMENT_LINK_TOKEN_SECRET = salvos.dedicado
      if (salvos.interno === undefined) delete process.env.INTERNAL_API_SECRET
      else process.env.INTERNAL_API_SECRET = salvos.interno
      if (salvos.service === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
      else process.env.SUPABASE_SERVICE_ROLE_KEY = salvos.service
    }
  })
})
