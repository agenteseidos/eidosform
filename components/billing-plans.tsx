'use client'

import { useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PLAN_ORDER, normalizePlan, type PlanId } from '@/lib/plans'

const plans = [
  {
    id: 'free',
    name: 'Free',
    emoji: '🌱',
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
    emoji: '⚡',
    price: { monthly: 49, annual: 29 },
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
    emoji: '🚀',
    price: { monthly: 127, annual: 97 },
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
    emoji: '👑',
    price: { monthly: 257, annual: 197 },
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
            className={`px-5 py-2 rounded-full text-sm font-semibold transition-all ${
              billing === 'monthly'
                ? 'bg-white text-slate-900 shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Mensal
          </button>
          <button
            onClick={() => setBilling('annual')}
            className={`relative px-5 py-2 rounded-full text-sm font-semibold transition-all flex items-center gap-2 ${
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
              Economize até 40%
            </span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
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

          return (
            <div
              key={plan.id}
              className={`relative flex flex-col rounded-2xl border p-6 transition-all ${
                isCurrentPlan
                  ? 'bg-slate-900 border-[#F5B731]/70 shadow-xl shadow-[#F5B731]/15 ring-1 ring-[#F5B731]/25'
                  : plan.highlight
                  ? 'bg-slate-900 border-[#F5B731]/60 shadow-xl shadow-[#F5B731]/15 ring-1 ring-[#F5B731]/20'
                  : isLowerPlan
                  ? 'bg-slate-900/55 border-white/10'
                  : 'bg-slate-900/60 border-white/[0.08]'
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
                  <Badge className="bg-[#F5B731] text-black font-bold border-0 px-3 shadow-lg shadow-[#F5B731]/30">
                    ✨ Mais Popular
                  </Badge>
                </div>
              ) : null}

              <div className="text-2xl mb-2">{plan.emoji}</div>
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                  <p className="text-xs text-slate-400">{plan.desc}</p>
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
                      <span className="text-3xl font-black text-white">R${price}</span>
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

              <ul className="space-y-2 mb-6 flex-1">
                {plan.features.map((feature, i) => (
                  <li key={i} className={`flex items-start gap-2 text-sm ${isLowerPlan ? 'text-slate-200' : 'text-slate-300'}`}>
                    <Check className="w-4 h-4 mt-0.5 flex-shrink-0 text-[#4BB678]" />
                    <span className="leading-5">{feature}</span>
                  </li>
                ))}
              </ul>

              <Button
                className={`w-full font-semibold transition-all mt-auto ${
                  isCurrentPlan || isLowerPlan
                    ? 'bg-white/5 text-slate-400 border border-white/10 cursor-default hover:bg-white/5'
                    : shouldHighlight || isHigherPlan
                    ? 'bg-[#F5B731] hover:bg-yellow-500 text-black shadow-lg shadow-[#F5B731]/25'
                    : 'bg-white/10 hover:bg-white/15 text-white border border-white/10'
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
