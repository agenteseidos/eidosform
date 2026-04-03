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
      '1 usuário',
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
    price: { monthly: 49, annual: 39.2 },
    desc: 'Para freelancers',
    highlight: false,
    features: [
      'Tudo do Free +',
      '1.000 respostas/mês',
      '10 formulários',
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
    price: { monthly: 127, annual: 101.6 },
    desc: 'Para equipes',
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
    price: { monthly: 257, annual: 205.6 },
    desc: 'Para empresas',
    highlight: false,
    features: [
      'Tudo do Plus +',
      '15.000 respostas/mês',
      'Até 10 usuários',
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
}

export function BillingPlans({ currentPlan }: BillingPlansProps) {
  const [billing, setBilling] = useState<'annual' | 'monthly'>('monthly')
  const normalizedCurrentPlan = useMemo(() => normalizePlan(currentPlan), [currentPlan])
  const currentPlanIndex = PLAN_ORDER.indexOf(normalizedCurrentPlan)

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
              Economize 20%
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
          const isHigherPlan = thisPlanIndex > currentPlanIndex
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
                  : isLowerPlan
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
                {isLowerPlan && (
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
                  isCurrentPlan
                    ? 'bg-white/5 text-slate-500 border border-white/10 cursor-not-allowed'
                    : isLowerPlan
                    ? 'bg-white/5 text-slate-400 border border-white/[0.06] cursor-not-allowed'
                    : 'bg-[#F5B731] hover:bg-[#e5a820] text-black font-bold shadow-lg shadow-[#F5B731]/25'
                }`}
                disabled={isCurrentPlan || isLowerPlan}
                onClick={() => {
                  if (!isCurrentPlan && !isLowerPlan && plan.checkoutUrl) {
                    window.location.href = plan.checkoutUrl
                  }
                }}
              >
                {isCurrentPlan ? 'Plano atual' : isLowerPlan ? 'Já incluso no seu plano' : plan.cta}
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
