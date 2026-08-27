/**
 * RETENTATIVA DE NFS-e REJEITADA — a decisão que separa "prefeitura engasgou" de tudo o mais.
 *
 * Origem (27/08/2026): primeira nota de valor cheio voltou com L999 vazio; a retentativa manual
 * autorizou minutos depois sem mudar nada (nota municipal 1013714). O perigo desta feature não
 * é retentar pouco — é retentar o que NÃO deve: nota de pagamento estornado (documento fiscal
 * de receita que não existe) ou nota criada à mão no painel (não é nossa).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decidirRetentativaNota, MAX_TENTATIVAS_NOTA } from './nfse'

const NOSSA = 'nfse:pay:pay_abc123'

describe('🛡️ o caso do incidente: instabilidade da prefeitura → retenta', () => {
  it('nota nossa, pagamento vigente, dentro do teto → retenta', () => {
    expect(decidirRetentativaNota({ externalReference: NOSSA, paymentStatus: 'CONFIRMED', tentativasFeitas: 0 }))
      .toEqual({ retentar: true })
    expect(decidirRetentativaNota({ externalReference: NOSSA, paymentStatus: 'RECEIVED', tentativasFeitas: MAX_TENTATIVAS_NOTA - 1 }))
      .toEqual({ retentar: true })
  })
})

describe('🛡️ o que NUNCA pode ser retentado', () => {
  it('pagamento ESTORNADO → nunca — seria nota fiscal de receita que não existe', () => {
    for (const st of ['REFUNDED', 'DELETED', 'CHARGEBACK_REQUESTED', 'PENDING', 'OVERDUE']) {
      expect(decidirRetentativaNota({ externalReference: NOSSA, paymentStatus: st, tentativasFeitas: 0 }))
        .toEqual({ retentar: false, motivo: 'pagamento_nao_vigente' })
    }
  })

  it('nota que NÃO emitimos (sem o carimbo nfse:pay:) → não é nossa para reenviar', () => {
    for (const ref of [null, undefined, '', 'outra-coisa', 'pay_abc123']) {
      expect(decidirRetentativaNota({ externalReference: ref, paymentStatus: 'CONFIRMED', tentativasFeitas: 0 }))
        .toEqual({ retentar: false, motivo: 'nao_gerida' })
    }
  })

  it('"não sei o status do pagamento" NÃO vira decisão — adia sem gastar tentativa', () => {
    // Mesma regra da dívida pendente: falha de leitura ≠ fato. A próxima hora relê.
    expect(decidirRetentativaNota({ externalReference: NOSSA, paymentStatus: null, tentativasFeitas: 0 }))
      .toEqual({ retentar: false, motivo: 'pagamento_ilegivel' })
  })

  it('esgotou o teto → para (a causa provável virou cadastral; a conversa é com o contador)', () => {
    expect(decidirRetentativaNota({ externalReference: NOSSA, paymentStatus: 'CONFIRMED', tentativasFeitas: MAX_TENTATIVAS_NOTA }))
      .toEqual({ retentar: false, motivo: 'esgotado' })
  })
})

describe('🛡️ a rota que executa', () => {
  const rota = readFileSync(join(__dirname, '..', 'app', 'api', 'cron', 'nfse-retry', 'route.ts'), 'utf-8')

  it('reivindica o marcador ANTES de chamar a prefeitura (corrida perde no UNIQUE, nunca duplica)', () => {
    const idxClaim = rota.indexOf('nfse-retry:${invoiceId}:${n}')
    const idxSend = rota.indexOf('authorizeInvoice(invoiceId)')
    expect(idxClaim).toBeGreaterThan(-1)
    expect(idxSend).toBeGreaterThan(-1)
    expect(idxClaim).toBeLessThan(idxSend)
  })

  it('o alerta de esgotamento devolve o marcador se a entrega falhar (lição do watchdog de 25/08)', () => {
    expect(rota).toContain('nfse-retry-esgotado')
    expect(rota).toMatch(/delete\(\)[\s\S]{0,80}nfse-retry-esgotado/)
  })

  it('contabilidade fechada: todos os desfechos aparecem na resposta (lição do expire-plans)', () => {
    for (const c of ['retentadas', 'naoGeridas', 'ilegiveis', 'naoVigentes', 'esgotadas', 'corridas', 'falhas']) {
      expect(rota).toContain(c)
    }
  })
})
