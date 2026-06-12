/**
 * lib/plan-definitions.ts — client-safe plan definitions
 * Static plan config only. No server-only imports here.
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
  customDomain: boolean
  apiAccess: boolean
  partialResponses: boolean
  csvExport: boolean
  pdfExport: boolean
  webhooks: boolean
  redirect: boolean
  emailNotifications: boolean
  whatsappNotifications: boolean
  prioritySupport: boolean
  features: string[]
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
    customDomain: false,
    apiAccess: false,
    partialResponses: false,
    csvExport: false,
    pdfExport: false,
    webhooks: false,
    redirect: false,
    emailNotifications: false,
    whatsappNotifications: false,
    prioritySupport: false,
    features: [
      '100 respostas/mês',
      '3 formulários',
      'Questões ilimitadas',
      'Validação CPF/CNPJ',
      'Busca automática de CEP',
      'Lógica condicional',
      'Tela de agradecimento',
      'Suporte por email',
      "Marca d'água EidosForm",
    ],
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
    customDomain: false,
    apiAccess: false,
    partialResponses: false,
    csvExport: true,
    pdfExport: false,
    webhooks: false,
    redirect: true,
    emailNotifications: false,
    whatsappNotifications: false,
    prioritySupport: false,
    features: [
      'Tudo do Free +',
      '1.000 respostas/mês',
      '100 formulários',
      'Agendamento com Calendly',
      'Redirecionamento após envio',
      'Exportação CSV',
      "Marca d'água EidosForm",
    ],
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
    customDomain: false,
    apiAccess: false,
    partialResponses: true,
    csvExport: true,
    pdfExport: true,
    webhooks: true,
    redirect: true,
    emailNotifications: true,
    whatsappNotifications: true,
    prioritySupport: true,
    features: [
      'Tudo do Starter +',
      '5.000 respostas/mês',
      'Formulários ilimitados',
      "Sem marca d'água",
      'Respostas parciais',
      'Taxa de abandono por pergunta',
      'Bloco HTML / Embeds',
      'Notificação por email',
      'Notificação por WhatsApp',
      'Alerta de limite (80%)',
      'Meta Pixel (Facebook)',
      'Google Ads (Conversões)',
      'Google Tag Manager (GTM)',
      'TikTok Pixel',
      'Webhooks para automações',
      'Suporte prioritário',
    ],
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
    customDomain: true,
    apiAccess: true,
    partialResponses: true,
    csvExport: true,
    pdfExport: true,
    webhooks: true,
    redirect: true,
    emailNotifications: true,
    whatsappNotifications: true,
    prioritySupport: true,
    features: [
      'Tudo do Plus +',
      '15.000 respostas/mês',
      'Domínio personalizado',
      'Acesso à API v1',
      'Chave de API dedicada',
      'Exportação CSV avançada',
      'Suporte prioritário com SLA',
      'Notificação por WhatsApp',
    ],
  },
}

export interface PlanLimits {
  maxResponses: number
  maxQuestions: number
  maxForms: number
  watermark: boolean
  pixels: boolean
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
      customDomain: p.customDomain,
      apiAccess: p.apiAccess,
      maxUsers: p.maxUsers,
    },
  ])
) as Record<PlanName, PlanLimits>

export function getPlanLimits(plan: PlanName): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free
}
