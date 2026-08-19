/**
 * Teste de consistência VITRINE × RUNTIME (Fase 2, auditoria LP 2026-07-28).
 *
 * A auditoria encontrou 6 cópias divergentes da lista de planos. Este teste
 * garante que a fonte única (plan-marketing) nunca prometa o que os flags de
 * PLANS (plan-definitions) negam — e que números (preço, cota, questões,
 * formulários) batam com o runtime. Se um bullet novo mencionar uma feature
 * gated sem lastro, o teste quebra ANTES de a promessa ir pro ar.
 */
import { describe, it, expect } from 'vitest'
import { PLAN_MARKETING, PLAN_MARKETING_LIST } from './plan-marketing'
import { PLANS, type PlanConfig } from './plan-definitions'
import { PLAN_ORDER, planAtLeast, type PlanId } from './plans'

// Cada regra: se um bullet casa com `pattern`, o plano PRECISA passar em `holds`.
const CLAIM_RULES: Array<{
  label: string
  pattern: RegExp
  holds: (p: PlanConfig, id: PlanId) => boolean
}> = [
  { label: 'Webhooks', pattern: /webhook/i, holds: (p) => p.webhooks },
  { label: "Sem marca d'água", pattern: /sem marca d'água/i, holds: (p) => !p.watermark },
  // Promessa de que TEM marca d'água (transparência no Free/Starter)
  { label: "Marca d'água presente", pattern: /^marca d'água/i, holds: (p) => p.watermark },
  { label: 'Google Sheets', pattern: /google sheets/i, holds: (p) => p.googleSheets },
  {
    label: 'Pixels (Meta/Ads/GTM/TikTok)',
    pattern: /meta pixel|google ads|tag manager|tiktok/i,
    holds: (p) => p.pixels,
  },
  {
    label: 'Conversões por resposta (pixel)',
    pattern: /conversões personalizadas/i,
    holds: (p) => p.pixels,
  },
  // Envio pelo SERVIDOR (18/08/2026). Regra própria porque o padrão de pixels acima procura
  // "meta pixel" e não casaria com "Meta CAPI" — o bullet entraria sem lastro obrigatório.
  // O runtime usa o MESMO gate (`ownerPlanConfig?.pixels` em app/api/responses/route.ts), então
  // é `p.pixels` que tem de segurar a promessa.
  {
    label: 'Conversão server-side (CAPI)',
    pattern: /server-side|capi/i,
    holds: (p) => p.pixels,
  },
  { label: 'Respostas parciais', pattern: /respostas parciais/i, holds: (p) => p.partialResponses },
  // Taxa de abandono usa o mesmo gate de partialResponses no runtime
  // (app/api/forms/[id]/analytics/route.ts:82)
  { label: 'Taxa de abandono', pattern: /taxa de abandono/i, holds: (p) => p.partialResponses },
  { label: 'Domínio personalizado', pattern: /domínio personalizado/i, holds: (p) => p.customDomain },
  { label: 'API v1', pattern: /api v1/i, holds: (p) => p.apiAccess },
  { label: 'Redirecionamento', pattern: /redirecionamento/i, holds: (p) => p.redirect },
  { label: 'Exportação CSV', pattern: /exportação csv/i, holds: (p) => p.csvExport },
  { label: 'Exportação PDF', pattern: /exportação pdf/i, holds: (p) => p.pdfExport },
  {
    // Só EMAIL desde 2026-07-30 — a notificação por WhatsApp saiu da vitrine
    // (ver `nenhum plano promete notificação de LEAD por WhatsApp` abaixo).
    label: 'Notificação por email',
    pattern: /notificação por email/i,
    holds: (p) => p.emailNotifications,
  },
  // Alerta de LEAD ABANDONADO por e-mail (Entrega 2, 2026-07-30). A regra entra
  // ANTES do bullet: quando a vitrine anunciar isso, já nasce com lastro
  // obrigatório em PLANS[].abandonedLeadAlert. Ordem exigida pelo plano —
  // primeiro o alerta funcionando, depois a promessa.
  {
    label: 'Alerta de lead abandonado',
    pattern: /lead abandonado|lead incompleto|quem desistiu/i,
    holds: (p) => p.abandonedLeadAlert,
  },
  // Alerta de 80% é Plus+ (decisão 0.2b; gate real em sendNearLimitAlert)
  { label: 'Alerta de limite 80%', pattern: /alerta de limite/i, holds: (_p, id) => planAtLeast(id, 'plus') },
  // Bloco HTML é o tipo html_block, gated Plus+ (QUESTION_TYPE_MIN_PLAN)
  { label: 'Bloco HTML', pattern: /bloco html/i, holds: (_p, id) => planAtLeast(id, 'plus') },
  // CPF/CNPJ e Calendly são tipos Starter+ (QUESTION_TYPE_MIN_PLAN)
  { label: 'CPF/CNPJ', pattern: /cpf\/cnpj/i, holds: (_p, id) => planAtLeast(id, 'starter') },
  { label: 'Calendly', pattern: /calendly/i, holds: (_p, id) => planAtLeast(id, 'starter') },
]

describe('plan-marketing × plan-definitions', () => {
  it('cobre todos os planos, na ordem canônica', () => {
    expect(PLAN_MARKETING_LIST.map((p) => p.id)).toEqual([...PLAN_ORDER])
  })

  for (const id of PLAN_ORDER) {
    const mkt = PLAN_MARKETING[id]
    const cfg = PLANS[id]

    describe(`plano ${id}`, () => {
      it('preços derivam do runtime', () => {
        expect(mkt.price.monthly).toBe(cfg.monthlyPrice)
        expect(mkt.price.annual).toBe(cfg.yearlyPrice)
      })

      it('cota de respostas bate com maxResponses', () => {
        expect(mkt.responsesLabel).toBe(
          `${cfg.maxResponses.toLocaleString('pt-BR')} respostas/mês`
        )
      })

      it('limite de questões anunciado bate com maxQuestions', () => {
        const line = mkt.features.find((f) => /questões por formulário/i.test(f))
        expect(line, 'todo plano anuncia o limite de questões').toBeDefined()
        expect(line).toContain(`Até ${cfg.maxQuestions} questões`)
      })

      it('contagem de formulários bate com maxForms', () => {
        if (cfg.maxForms === -1) {
          // Ilimitado: ou anuncia "ilimitados" (Plus) ou herda via "Tudo do X +"
          const claimsFinite = mkt.features.some((f) => /^\d+ formulários/.test(f))
          expect(claimsFinite).toBe(false)
        } else {
          const line = mkt.features.find((f) => /^\d+ formulários/.test(f))
          expect(line, `plano ${id} (finito) anuncia a contagem de forms`).toBeDefined()
          expect(line).toBe(`${cfg.maxForms} formulários`)
        }
      })

      it('nenhum bullet promete o que o runtime nega', () => {
        for (const feature of mkt.features) {
          for (const rule of CLAIM_RULES) {
            if (rule.pattern.test(feature)) {
              expect(
                rule.holds(cfg, id),
                `"${feature}" (regra: ${rule.label}) sem lastro no plano ${id}`
              ).toBe(true)
            }
          }
        }
      })
    })
  }

  it('"CSV avançada" não existe em nenhuma vitrine (decisão 0.3 — era promessa vazia)', () => {
    for (const p of PLAN_MARKETING_LIST) {
      expect(p.features.some((f) => /csv avançad/i.test(f))).toBe(false)
    }
  })

  it('Professional não repete WhatsApp (D4 — já herdado do Plus via "Tudo do Plus +")', () => {
    expect(PLAN_MARKETING.professional.features.some((f) => /whatsapp/i.test(f))).toBe(false)
  })

  it('NENHUM plano promete notificação de LEAD por WhatsApp (decisão Sidney 2026-07-30)', () => {
    // A feature saiu da vitrine: depende de cliente não-oficial que levou a linha
    // a uma restrição de 6h, e hoje vale só p/ a lista de `whatsapp-capability`.
    // ⚠️ "Suporte por WhatsApp" (canal de atendimento) CONTINUA válido e não pode
    // ser pego por esta regra — por isso o padrão é específico de notificação.
    const promessaDeNotificacao = /(notifica\w*|alerta\w*|lead\w*|receb\w*)[^,]*whatsapp|whatsapp[^,]*(notifica\w*|lead\w*)/i
    for (const p of PLAN_MARKETING_LIST) {
      for (const f of p.features) {
        expect(promessaDeNotificacao.test(f), `"${f}" promete notificação por WhatsApp sem lastro`).toBe(false)
      }
    }
  })

  it('"Suporte por WhatsApp" segue permitido (é canal, não a feature)', () => {
    const temSuporte = PLAN_MARKETING_LIST.some((p) =>
      p.features.some((f) => /suporte por whatsapp/i.test(f))
    )
    expect(temSuporte).toBe(true)
  })
})
