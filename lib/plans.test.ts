/**
 * A CARÊNCIA DE INADIMPLÊNCIA — o portão que decide o que o cliente REALMENTE tem.
 *
 * Contexto (25/08/2026): até esta data o produto tinha SPLIT-BRAIN. O `/api/user/plan-features`
 * honrava os 5 dias de carência e mostrava "Plus · 5.000"; `getEffectivePlan` — usada em ~20
 * rotas, no formulário público e na cota — devolvia 'free' no segundo seguinte ao vencimento.
 * O cliente inadimplente via no painel um plano que o produto já não entregava, e a régua de
 * cobrança prometia um prazo que nenhum portão respeitava.
 *
 * Decisão do Sidney: a carência vale de verdade (mantém tudo até o 5º dia), MAS
 *  · quem CANCELA não ganha os 5 dias — usa o que pagou e cai no free; e
 *  · o prazo é DURO: acaba por cálculo, não por o cron ter rodado.
 */
import { describe, it, expect } from 'vitest'
import { getEffectivePlan, CARENCIA_INADIMPLENCIA_DIAS } from './plans'

/** Cenário real do teste de inadimplência de 20-25/08/2026, com os valores que estavam no banco. */
const VENCE_EM = '2026-08-21T02:59:59+00:00'          // 20/08 23:59:59 BRT — fim do período pago
const DEVIDO_EM = Date.parse('2026-08-25T03:00:00Z')  // 25/08 00:00 BRT — instante do rebaixamento
const emT = (ms: number) => ms

const inadimplente = (over: Record<string, unknown> = {}) => ({
  plan: 'plus', plan_expires_at: VENCE_EM,
  plan_status: 'active', asaas_subscription_id: 'sub_e2a1ckw3m2m431y7', ...over,
})

describe('🛡️ carência: o inadimplente mantém o que pagou até o 5º dia', () => {
  it('antes de vencer, o plano vale — carência nem entra na conta', () => {
    expect(getEffectivePlan(inadimplente(), Date.parse('2026-08-20T12:00:00Z'))).toBe('plus')
  })

  it('vencido e DENTRO da carência → mantém o plano pago (era o bug: devolvia free)', () => {
    expect(getEffectivePlan(inadimplente(), Date.parse('2026-08-23T12:00:00Z'))).toBe('plus')
  })

  it('um milissegundo antes do fim da carência → ainda mantém', () => {
    expect(getEffectivePlan(inadimplente(), emT(DEVIDO_EM - 1))).toBe('plus')
  })

  it('PRAZO DURO: no instante do rebaixamento a carência acaba SOZINHA', () => {
    // A guarda que impede a carência de virar acesso pago de graça: se o expire-plans nunca
    // rodar, o benefício acaba na mesma hora. A falha do cron não vira acesso vitalício.
    expect(getEffectivePlan(inadimplente(), emT(DEVIDO_EM))).toBe('free')
    expect(getEffectivePlan(inadimplente(), Date.parse('2027-01-01T00:00:00Z'))).toBe('free')
  })

  it('a carência acaba no MESMO instante em que o expire-plans rebaixa', () => {
    // Se as duas âncoras divergirem, volta o split-brain — em outro lugar. `plan_expires_at` é
    // FIM de dia BRT; o rebaixamento conta dias inteiros a partir da MEIA-NOITE do vencimento.
    const umSegundoAntes = getEffectivePlan(inadimplente(), emT(DEVIDO_EM - 1_000))
    const noInstante = getEffectivePlan(inadimplente(), emT(DEVIDO_EM))
    expect([umSegundoAntes, noInstante]).toEqual(['plus', 'free'])
  })
})

describe('🛡️ carência: quem NÃO é inadimplente não ganha nada', () => {
  it('quem CANCELOU cai no free ao fim do período pago — sem os 5 dias', () => {
    // Decisão do Sidney (25/08): usa o que pagou e acabou. A carência existe para cartão
    // recusado, não para quem pediu para sair.
    const cancelou = inadimplente({ plan_status: 'canceling' })
    expect(getEffectivePlan(cancelou, Date.parse('2026-08-21T03:00:01Z'))).toBe('free')
    expect(getEffectivePlan(cancelou, Date.parse('2026-08-23T12:00:00Z'))).toBe('free')
  })

  it('sem assinatura viva no gateway não há o que retentar → sem carência', () => {
    const semSub = inadimplente({ asaas_subscription_id: null })
    expect(getEffectivePlan(semSub, Date.parse('2026-08-23T12:00:00Z'))).toBe('free')
  })

  it('FAIL-CLOSED: chamador que não seleciona os campos se comporta como antes', () => {
    // ~20 rotas passam o profile inteiro; se alguém criar uma rota nova e esquecer os campos,
    // o pior que acontece é o comportamento ANTIGO (degrada no vencimento) — nunca conceder
    // acesso pago por engano.
    expect(getEffectivePlan({ plan: 'plus', plan_expires_at: VENCE_EM }, Date.parse('2026-08-23T12:00:00Z'))).toBe('free')
    expect(getEffectivePlan({ plan: 'plus', plan_expires_at: VENCE_EM, plan_status: 'active' }, Date.parse('2026-08-23T12:00:00Z'))).toBe('free')
  })

  it('free continua free, e data ilegível não concede nada', () => {
    expect(getEffectivePlan(inadimplente({ plan: 'free' }), Date.parse('2026-08-23T12:00:00Z'))).toBe('free')
    expect(getEffectivePlan(inadimplente({ plan_expires_at: 'não-é-data' }), Date.parse('2026-08-23T12:00:00Z'))).toBe('plus')
    expect(getEffectivePlan(null, Date.parse('2026-08-23T12:00:00Z'))).toBe('free')
  })
})

describe('🛡️ o checkout NÃO pode enxergar a carência', () => {
  it('a recompra segue destravada: sem os campos, vencido conta como free', () => {
    // Regressão que este teste guarda: se alguém "padronizar" o checkout para passar o profile
    // inteiro, o inadimplente vira 'plus' e o checkLaunchScope recusa com 409 justamente quem
    // está tentando voltar a pagar. Ver o comentário nas duas rotas de checkout.
    const comoOCheckoutChama = { plan: 'plus', plan_expires_at: VENCE_EM }
    expect(getEffectivePlan(comoOCheckoutChama, Date.parse('2026-08-23T12:00:00Z'))).toBe('free')
  })
})

describe('🛡️ fonte única do número', () => {
  it('a carência é 5 dias e é a MESMA constante que a régua e o rebaixamento usam', async () => {
    expect(CARENCIA_INADIMPLENCIA_DIAS).toBe(5)
    const { PRAZO_DIAS } = await import('./dunning-engine')
    expect(PRAZO_DIAS).toBe(CARENCIA_INADIMPLENCIA_DIAS)
  })

  it('o SQL da cota usa o MESMO número de dias que o TypeScript', async () => {
    // O banco não importa constante de TS: lá o 5 é literal. Este teste é a única amarra
    // possível entre os dois lados — se alguém mudar a carência aqui e esquecer o banco,
    // volta o split-brain que esta mudança existe para matar.
    // ⚠️ LIMITE HONESTO: isto guarda o ARQUIVO da migration, não o banco. Só a sonda real
    // (no fim do próprio .sql) prova o que está rodando. Regra nº 1 deste projeto.
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20260825_carencia_cota.sql'), 'utf-8')
    expect(sql).toContain(`interval '${CARENCIA_INADIMPLENCIA_DIAS} days'`)
    // E a âncora: sem truncar para o dia BRT, o SQL concederia ~24h a mais que o expire-plans.
    expect(sql).toContain(`date_trunc('day', v_expires AT TIME ZONE 'America/Sao_Paulo')`)
    // E as duas guardas que impedem a carência de virar acesso pago de graça.
    expect(sql).toContain(`v_plan_status = 'active' AND v_sub_id IS NOT NULL`)
  })
})
