/**
 * lib/plan-marketing.ts — FONTE ÚNICA da vitrine de planos.
 *
 * Criado na Fase 2 da auditoria LP (2026-07-28): a lista de features de
 * marketing estava HARDCODED em 6 lugares (plan-definitions + 5 componentes)
 * e divergia entre eles — Sheets sumido do Starter, marca d'água omitida,
 * "CSV avançada" sem lastro, etc. Agora TODA vitrine (raiz, v2, v3, v4 e
 * billing) importa daqui; preços e cotas são DERIVADOS de PLANS
 * (lib/plan-definitions.ts), a verdade do runtime.
 *
 * Regras de conteúdo (decisões Sidney 2026-07-28):
 *  - Cada bullet precisa ter lastro num flag/limite de PLANS — o teste
 *    lib/plan-marketing.test.ts falha se a vitrine prometer o que o runtime
 *    nega (e vice-versa nos casos mapeados).
 *  - "Exportação CSV avançada" REMOVIDA do Professional (decisão 0.3 — era o
 *    mesmo CSV do Starter, mesmo flag csvExport).
 *  - Alerta de 80% é vendido só no Plus+ (decisão 0.2b — gate real em
 *    sendNearLimitAlert).
 *  - Excel (.xlsx) e PDF entram na vitrine: entregues e não vendidos
 *    (Excel = gate csvExport/Starter+; PDF = pdfExport/Plus+).
 *  - Free/Starter voltam a declarar a marca d'água (watermark: true) e o
 *    suporte do Free é por WhatsApp (canal real do rodapé/código).
 */

import { PLAN_ORDER, type PlanId } from '@/lib/plans'
import { PLANS } from '@/lib/plan-definitions'

export interface PlanMarketing {
  id: PlanId
  name: string
  /** Subtítulo do card, ex.: 'Para freelancers e autônomos' */
  desc: string
  /** Linha de cota destacada, ex.: '1.000 respostas/mês' */
  responsesLabel: string
  price: { monthly: number; annual: number }
  /**
   * Bullets da vitrine — SEM a linha de respostas (os layouts v2/v3/v4 a
   * exibem à parte; raiz/billing fazem prepend de responsesLabel).
   */
  features: string[]
  cta: string
}

const fmt = (n: number) => n.toLocaleString('pt-BR')

function base(id: PlanId): Pick<PlanMarketing, 'id' | 'name' | 'responsesLabel' | 'price'> {
  const p = PLANS[id]
  return {
    id,
    name: p.name,
    responsesLabel: `${fmt(p.maxResponses)} respostas/mês`,
    price: { monthly: p.monthlyPrice, annual: p.yearlyPrice },
  }
}

export const PLAN_MARKETING: Record<PlanId, PlanMarketing> = {
  free: {
    ...base('free'),
    desc: 'Para testar sem compromisso',
    cta: 'Começar grátis',
    features: [
      `${PLANS.free.maxForms} formulários`,
      `Até ${PLANS.free.maxQuestions} questões por formulário`,
      'Busca automática de CEP',
      'Lógica condicional',
      'Tela de agradecimento personalizada',
      'Suporte por WhatsApp',
      "Marca d'água EidosForm",
    ],
  },
  starter: {
    ...base('starter'),
    desc: 'Para freelancers e autônomos',
    cta: 'Assinar Starter',
    features: [
      'Tudo do Free +',
      `${PLANS.starter.maxForms} formulários`,
      `Até ${PLANS.starter.maxQuestions} questões por formulário`,
      'Validação de CPF/CNPJ',
      'Agendamento com Calendly',
      'Redirecionamento após envio',
      'Exportação CSV e Excel',
      'Integração com Google Sheets',
      "Marca d'água EidosForm",
    ],
  },
  plus: {
    ...base('plus'),
    desc: 'Para quem vive de conversão',
    cta: 'Assinar Plus',
    features: [
      'Tudo do Starter +',
      'Formulários ilimitados',
      `Até ${PLANS.plus.maxQuestions} questões por formulário`,
      "Sem marca d'água EidosForm",
      'Respostas parciais (capture o lead mesmo sem envio)',
      'Taxa de abandono por pergunta',
      'Meta Pixel (Facebook)',
      'Google Ads (Conversões)',
      'Google Tag Manager (GTM)',
      'TikTok Pixel',
      'Conversões personalizadas por resposta',
      'Webhooks para automações',
      'Notificação por email e WhatsApp',
      'Alerta de limite (80%)',
      'Bloco HTML / Embeds',
      'Exportação PDF',
      'Suporte prioritário',
    ],
  },
  professional: {
    ...base('professional'),
    desc: 'Para agências e empresas',
    cta: 'Assinar Professional',
    features: [
      'Tudo do Plus +',
      `Até ${PLANS.professional.maxQuestions} questões por formulário`,
      'Domínio personalizado (a marca do seu cliente)',
      'Acesso à API v1 + chave dedicada',
      'Prioridade máxima no suporte',
    ],
  },
}

/** Lista na ordem canônica free → starter → plus → professional. */
export const PLAN_MARKETING_LIST: PlanMarketing[] = PLAN_ORDER.map((id) => PLAN_MARKETING[id])
