'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { motion } from 'framer-motion'

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
    cta: 'Começar grátis',
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
  },
]

export function PricingSection() {
  const [billing, setBilling] = useState<'annual' | 'monthly'>('annual')

  return (
    <section id="precos" className="py-24 px-4 sm:px-6 bg-white/[0.02]">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-10">
          <Badge className="mb-4 bg-white/5 text-slate-400 border border-white/10">Planos</Badge>
          <h2 className="text-3xl sm:text-5xl font-black mb-4">
            Preço justo,
            <span className="block text-slate-400">sem surpresas</span>
          </h2>
          <p className="text-slate-400 text-lg mb-8">Comece grátis, escale quando precisar.</p>

          {/* Toggle */}
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
              className={`relative px-5 py-2 rounded-full text-sm font-semibold transition-all flex items-center gap-2.5 ${
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
          {billing === 'annual' && (
            <p className="mt-3 text-sm text-[#4BB678]">✓ Economize até 40% com o plano anual</p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 px-1">
          {plans.map((plan, idx) => {
            const price = billing === 'annual' ? plan.price.annual : plan.price.monthly
            const originalPrice = plan.price.monthly

            return (
              <motion.div
                key={plan.id}
                initial={false}
                whileHover={{ y: -4 }}
                transition={{ duration: 0.2 }}
                className={`relative flex flex-col p-6 rounded-2xl border transition-all duration-300 ${
                  plan.highlight
                    ? 'bg-slate-900 border-[#F5B731]/60 shadow-xl shadow-[#F5B731]/15 ring-1 ring-[#F5B731]/20 mt-4 sm:mt-0'
                    : 'bg-slate-900/60 border-white/[0.08] hover:border-white/15'
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap z-10">
                    <Badge className="bg-[#F5B731] text-black font-bold border-0 px-3 shadow-lg shadow-[#F5B731]/30">
                      ✨ Mais Popular
                    </Badge>
                  </div>
                )}

                <div className="text-2xl mb-2">{plan.emoji}</div>
                <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                <p className="text-sm text-slate-500 mb-4">{plan.desc}</p>

                <div className="mb-6">
                  {price === 0 ? (
                    <span className="text-3xl font-black text-white">Grátis</span>
                  ) : (
                    <div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-black text-white">R${price}</span>
                        <span className="text-slate-500 text-sm">/mês</span>
                      </div>
                      {billing === 'annual' && originalPrice !== price && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          <span className="line-through text-slate-400 text-sm">R${originalPrice}/mês</span>
                          <span className="text-[#4BB678] ml-1">no plano anual</span>
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <ul className="space-y-2 mb-6 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                      <Check className="w-4 h-4 text-[#4BB678] mt-0.5 flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>

                <Link href="/login" className="block mt-auto">
                  <Button
                    className={`w-full font-semibold ${
                      plan.highlight
                        ? 'bg-[#F5B731] hover:bg-[#E8923A] text-black shadow-lg shadow-[#F5B731]/25'
                        : 'bg-white/10 hover:bg-white/15 text-white border border-white/10'
                    }`}
                  >
                    {plan.cta}
                  </Button>
                </Link>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
