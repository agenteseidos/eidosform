/**
 * lib/plan-definitions.ts — client-safe plan definitions
 * Static plan config only. No server-only imports here.
 *
 * ATENÇÃO: aqui vivem só FLAGS e LIMITES (a verdade do runtime). Os bullets
 * de marketing da vitrine moram em lib/plan-marketing.ts (fonte única desde
 * a Fase 2 da auditoria LP 2026-07-28) e são validados contra estes flags
 * pelo lib/plan-marketing.test.ts.
 */

import { PlanId } from '@/lib/plans'

/** @deprecated Use PlanId from lib/plans.ts */
export type PlanName = PlanId

export interface PlanConfig {
  name: string
  popular?: boolean
  monthlyPrice: number
  yearlyPrice: number
  maxResponses: number
  maxForms: number
  maxQuestions: number
  maxUsers: number
  watermark: boolean
  pixels: boolean
  googleSheets: boolean
  customDomain: boolean
  apiAccess: boolean
  partialResponses: boolean
  csvExport: boolean
  pdfExport: boolean
  webhooks: boolean
  redirect: boolean
  emailNotifications: boolean
  whatsappNotifications: boolean
  /**
   * Alerta de LEAD ABANDONADO (comecou a preencher e parou) por e-mail.
   * Separado de `emailNotifications` de proposito: notificar resposta COMPLETA
   * e avisar quem DESISTIU sao promessas diferentes e podem ser vendidas
   * separadamente. Hoje andam juntas (Plus+), mas o flag existe para nao
   * precisar de refactor quando nao andarem.
   */
  abandonedLeadAlert: boolean
  prioritySupport: boolean
}

export const PLANS: Record<PlanName, PlanConfig> = {
  free: {
    name: 'Free',
    monthlyPrice: 0,
    yearlyPrice: 0,
    maxResponses: 100,
    maxForms: 3,
    maxQuestions: 25,
    maxUsers: 1,
    watermark: true,
    pixels: false,
    googleSheets: false,
    customDomain: false,
    apiAccess: false,
    partialResponses: false,
    csvExport: false,
    pdfExport: false,
    webhooks: false,
    redirect: false,
    emailNotifications: false,
    whatsappNotifications: false,
    abandonedLeadAlert: false,
    prioritySupport: false,
  },
  starter: {
    name: 'Starter',
    monthlyPrice: 49,
    yearlyPrice: 29,
    maxResponses: 1000,
    maxForms: 100,
    maxQuestions: 50,
    maxUsers: 1,
    watermark: true,
    pixels: false,
    googleSheets: true,
    customDomain: false,
    apiAccess: false,
    partialResponses: false,
    csvExport: true,
    pdfExport: false,
    webhooks: false,
    redirect: true,
    emailNotifications: false,
    whatsappNotifications: false,
    abandonedLeadAlert: false,
    prioritySupport: false,
  },
  plus: {
    name: 'Plus',
    popular: true,
    monthlyPrice: 127,
    yearlyPrice: 97,
    maxResponses: 5000,
    maxForms: -1,
    maxQuestions: 100,
    maxUsers: 1,
    watermark: false,
    pixels: true,
    googleSheets: true,
    customDomain: false,
    apiAccess: false,
    partialResponses: true,
    csvExport: true,
    pdfExport: true,
    webhooks: true,
    redirect: true,
    emailNotifications: true,
    whatsappNotifications: false,
    abandonedLeadAlert: true,
    prioritySupport: true,
  },
  professional: {
    name: 'Professional',
    monthlyPrice: 257,
    yearlyPrice: 197,
    maxResponses: 15000,
    maxForms: -1,
    maxQuestions: 200,
    maxUsers: 1, // multi-user removido da oferta (2026-06-10) até existir de verdade
    watermark: false,
    pixels: true,
    googleSheets: true,
    customDomain: true,
    apiAccess: true,
    partialResponses: true,
    csvExport: true,
    pdfExport: true,
    webhooks: true,
    redirect: true,
    emailNotifications: true,
    whatsappNotifications: false,
    abandonedLeadAlert: true,
    prioritySupport: true,
  },
}

export interface PlanLimits {
  maxResponses: number
  maxQuestions: number
  maxForms: number
  watermark: boolean
  pixels: boolean
  googleSheets: boolean
  customDomain: boolean
  apiAccess: boolean
  maxUsers: number
}

export const PLAN_LIMITS: Record<PlanName, PlanLimits> = Object.fromEntries(
  (Object.entries(PLANS) as [PlanName, PlanConfig][]).map(([key, p]) => [
    key,
    {
      maxResponses: p.maxResponses,
      maxQuestions: p.maxQuestions,
      maxForms: p.maxForms,
      watermark: p.watermark,
      pixels: p.pixels,
      googleSheets: p.googleSheets,
      customDomain: p.customDomain,
      apiAccess: p.apiAccess,
      maxUsers: p.maxUsers,
    },
  ])
) as Record<PlanName, PlanLimits>

export function getPlanLimits(plan: PlanName): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free
}
