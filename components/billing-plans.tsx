'use client'

import { useMemo, useState } from 'react'
import { Check, Crown, Rocket, Sprout, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PLAN_ORDER, normalizePlan } from '@/lib/plans'

const plans = [
  {
    id: 'free',
    name: 'Free',
    icon: Sprout,
    price: { monthly: 0, annual: 0 },
    desc: 'Para começar',
    highlight: false,
    features: [
      '100 respostas/mês',
      '3 formulários',
      'Questões ilimitadas',
      'Validação de CPF/CNPJ',
      'Busca automática de CEP',
      'Lógica condicional',
      'Tela de agradecimento personalizada',
      'Suporte por email',
      "Marca d'água EidosForm",
    ],
    // CTA não exibido: free é sempre plano atual ou "Já incluso"
    cta: null,
    checkoutUrl: null,
  },
  {
    id: 'starter',
    name: 'Starter',
    icon: Zap,
    price: { monthly: 49, annual: 29 },
    desc: 'Para freelancers',
    highlight: false,
    features: [
      'Tudo do Free +',
      '1.000 respostas/mês',
      '100 formulários',
      'Redirecionamento após envio',
      'Exportação CSV',
      "Marca d'água EidosForm",
    ],
    cta: 'Assinar Starter',
    checkoutUrl: '/checkout/starter',
  },
  {
    id: 'plus',
    name: 'Plus',
    icon: Rocket,
    price: { monthly: 127, annual: 97 },
    desc: 'Para escalar resultados',
    highlight: true,
    features: [
      'Tudo do Starter +',
      '5.000 respostas/mês',
      'Formulários ilimitados',
      "Sem marca d'água",
      'Respostas parciais (salvamento automático)',
      'Taxa de abandono por pergunta',
      'Notificação por email (nova resposta)',
      'Alerta de limite (80%)',
      'Meta Pixel (Facebook)',
      'Google Ads (Conversões)',
      'Google Tag Manager (GTM)',
      'TikTok Pixel',
      'Webhooks para automações',
      'Suporte prioritário',
    ],
    cta: 'Assinar Plus',
    checkoutUrl: '/checkout/plus',
  },
  {
    id: 'professional',
    name: 'Professional',
    icon: Crown,
    price: { monthly: 257, annual: 197 },
    desc: 'Para empresas',
    highlight: false,
    features: [
      'Tudo do Plus +',
      '15.000 respostas/mês',
      'Domínio personalizado',
      'Acesso à API v1',
      'Chave de API dedicada',
      'Exportação CSV avançada',
      'Suporte prioritário com SLA',
    ],
    cta: 'Assinar Professional',
    checkoutUrl: '/checkout/professional',
  },
] as const

interface BillingPlansProps {
  currentPlan: string
  currentCycle: string | null
  planStatus?: string | null
}

export function BillingPlans({ currentPlan, currentCycle, planStatus }: BillingPlansProps) {
  const [billing, setBilling] = useState<'annual' | 'monthly'>('annual')
  const normalizedCurrentPlan = useMemo(() => normalizePlan(currentPlan), [currentPlan])
  const currentPlanIndex = PLAN_ORDER.indexOf(normalizedCurrentPlan)
  // CANCELING: o usuário cancelou mas ainda tem saldo (período pago). Pode reassinar QUALQUER
  // plano pago (o saldo é aplicado como crédito — #2/#2b). Liberamos os botões (inclusive os
  // "menores"), em vez do bloqueio upgrade-only normal. (2026-06-08.)
  const isCanceling = planStatus === 'canceling'

  return (
    <div>
      <div className="flex justify-center mb-8">
        <div className="inline-flex items-center gap-1 bg-slate-900 border border-white/10 rounded-full p-1.5">
          <button
            onClick={() => setBilling('monthly')}
            className={`px-5 min-h-[44px] rounded-full text-sm font-semibold transition-all ${
              billing === 'monthly'
                ? 'bg-white text-slate-900 shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Mensal
          </button>
          <button
            onClick={() => setBilling('annual')}
            className={`relative px-5 min-h-[44px] rounded-full text-sm font-semibold transition-all flex items-center gap-2 ${
              billing === 'annual'
                ? 'bg-[#F5B731] text-black shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Anual
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              billing === 'annual'
                ? 'bg-black/20 text-black'
                : 'bg-[#F5B731]/20 text-[#F5B731]'
            }`}>
              Economize até 41%
            </span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => {
          const price = billing === 'annual' ? plan.price.annual : plan.price.monthly
          const originalPrice = plan.price.monthly
          const isCurrentPlan = plan.id === normalizedCurrentPlan
          const thisPlanIndex = PLAN_ORDER.indexOf(plan.id)
          const isLowerPlan = thisPlanIndex < currentPlanIndex
          const currentBillingCycle = billing === 'annual' ? 'YEARLY' : 'MONTHLY'
          const isSamePlanAndCycle = isCurrentPlan && currentCycle === currentBillingCycle
          const isPaidPlan = plan.id !== 'free'
          const isAnnualToMonthlySamePlan = isCurrentPlan && isPaidPlan && currentCycle === 'YEARLY' && currentBillingCycle === 'MONTHLY'
          const isMonthlyToAnnualSamePlan = isCurrentPlan && isPaidPlan && currentCycle === 'MONTHLY' && currentBillingCycle === 'YEARLY'
          const isUnknownCyclePaidPlan = isCurrentPlan && isPaidPlan && !currentCycle
          const isFreeCurrentPlan = isCurrentPlan && plan.id === 'free'
          // DOWNGRADE de tier liberado (decisão Sidney 2026-06-08): um plano PAGO menor que o
          // atual é um alvo de downgrade clicável (Starter quando no Plus). Free só via
          // cancelamento; troca de ciclo anual→mensal do mesmo plano segue desabilitada (mensagem).
          const isLowerPaidPlan = isLowerPlan && isPaidPlan
          // Canceling: libera TODO plano pago (saldo aplica); só free fica desabilitado.
          const disabled = isCanceling
            ? plan.id === 'free'
            : ((isLowerPlan && !isPaidPlan) || isSamePlanAndCycle || isAnnualToMonthlySamePlan || isFreeCurrentPlan || isUnknownCyclePaidPlan)
          // Badge "Mais Popular" só aparece no Plus para usuários no plano Free (social proof para conversão).
          // Quando o usuário já é pagante, o badge é ocultado intencionalmente.
          const shouldHighlight = !isCurrentPlan && plan.highlight && normalizedCurrentPlan === 'free' && plan.id === 'plus'
          const Icon = plan.icon

          return (
            <div
              key={plan.id}
              className={`relative flex h-full flex-col rounded-2xl border p-6 transition-all ${
                isCurrentPlan
                  ? 'bg-[#1a1f35] border-[#F5B731]/50 shadow-lg shadow-[#F5B731]/10 ring-1 ring-[#F5B731]/20'
                  : isLowerPlan && !isCanceling && !isPaidPlan
                  ? 'bg-[#111827] border-white/[0.06] opacity-60'
                  : 'bg-[#111827] border-white/10 hover:border-white/20'
              }`}
            >
              {isCurrentPlan ? (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap">
                  <Badge className="bg-[#F5B731] text-black font-bold border-0 px-3 shadow-lg shadow-[#F5B731]/30">
                    ✓ Plano atual
                  </Badge>
                </div>
              ) : shouldHighlight ? (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap">
                  <Badge className="bg-white/10 text-white font-semibold border border-white/15 px-3 backdrop-blur">
                    ✨ Mais Popular
                  </Badge>
                </div>
              ) : null}

              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 ring-1 ring-white/10">
                <Icon className="h-5 w-5 text-[#F5B731]" aria-hidden="true" />
              </div>
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                  <p className="text-sm text-slate-400">{plan.desc}</p>
                </div>
                {isLowerPlan && !isCanceling && !isPaidPlan && (
                  <Badge variant="secondary" className="bg-white/10 text-slate-300 border border-white/10">
                    Já incluso
                  </Badge>
                )}
              </div>

              <div className="mb-5">
                {price === 0 ? (
                  <span className="text-3xl font-black text-white">Grátis</span>
                ) : (
                  <div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-black text-white">R${Number.isInteger(price) ? price : price.toFixed(2).replace('.', ',')}</span>
                      <span className="text-sm text-slate-500">/mês</span>
                    </div>
                    {billing === 'annual' && originalPrice !== price && (
                      <p className="text-xs text-slate-500 mt-0.5">
                        <span className="line-through">R${originalPrice}/mês</span>
                        <span className="text-[#4BB678] ml-1">no plano anual</span>
                      </p>
                    )}
                  </div>
                )}
              </div>

              <ul className="space-y-2.5 mb-6 flex-1">
                {plan.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                    <Check className="w-4 h-4 mt-0.5 flex-shrink-0 text-[#4BB678]" />
                    <span className="leading-5">{feature}</span>
                  </li>
                ))}
              </ul>

              <Button
                className={`w-full font-semibold transition-all mt-auto ${
                  disabled
                    ? 'bg-white/5 text-slate-400 border border-white/[0.06] cursor-not-allowed'
                    : isCurrentPlan && isMonthlyToAnnualSamePlan
                    ? 'bg-[#F5B731] hover:bg-[#e5a820] text-black font-bold shadow-lg shadow-[#F5B731]/25 cursor-pointer'
                    : 'bg-[#F5B731] hover:bg-[#e5a820] text-black font-bold shadow-lg shadow-[#F5B731]/25'
                }`}
                disabled={disabled}
                onClick={() => {
                  if (!disabled && plan.checkoutUrl) {
                    window.location.href = `${plan.checkoutUrl}?cycle=${billing === 'annual' ? 'yearly' : billing}`
                  }
                }}
              >
                {isCanceling
                  ? (plan.id === 'free'
                    ? 'No vencimento'
                    : isSamePlanAndCycle
                    ? `Reativar ${plan.name}`
                    : plan.cta)
                  : isLowerPaidPlan
                  ? `Mudar para ${plan.name}`
                  : isLowerPlan
                  ? 'Já incluso no seu plano'
                  : isFreeCurrentPlan
                  ? 'Plano atual'
                  : isSamePlanAndCycle
                  ? 'Plano atual'
                  : isAnnualToMonthlySamePlan || isUnknownCyclePaidPlan
                  ? 'Indisponível no anual'
                  : isMonthlyToAnnualSamePlan
                  ? 'Mudar para anual'
                  : isCurrentPlan
                  ? 'Plano atual'
                  : plan.cta}
              </Button>
              {plan.id !== 'free' && !isLowerPlan && (
                <p className="text-xs text-slate-500 text-center mt-2.5">
                  💳 Cartão de crédito
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
