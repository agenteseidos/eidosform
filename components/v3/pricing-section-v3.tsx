'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { motion, useReducedMotion } from 'framer-motion'
import { PLAN_MARKETING_LIST } from '@/lib/plan-marketing'

// Pricing da /v3 — SELO DUPLO (decisão Sidney 2026-06-12):
//   • Plus mantém "Mais Popular" (comprador solo)
//   • Professional ganha "Para agências" com borda própria — a seção de
//     agências da página aponta direto pra ele
// Conteúdo vem da FONTE ÚNICA lib/plan-marketing.ts (Fase 2, auditoria LP
// 2026-07-28) — aqui só vive a apresentação (accent/tema).

type Accent = 'popular' | 'agency' | null

const ACCENTS: Partial<Record<string, Accent>> = { plus: 'popular', professional: 'agency' }

const plans = PLAN_MARKETING_LIST.map((p) => ({
  ...p,
  accent: ACCENTS[p.id] ?? null,
  responses: p.responsesLabel,
}))

export function PricingSectionV3() {
  const [billing, setBilling] = useState<'annual' | 'monthly'>('annual')
  const reduce = useReducedMotion()

  return (
    <section id="precos" className="py-14 sm:py-24 px-4 sm:px-6 bg-white/[0.02]">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-5xl font-black mb-4">
            Preço em real,
            <span className="block text-slate-400">sem surpresa no câmbio</span>
          </h2>
          <p className="text-slate-400 text-lg mb-8">
            Comece grátis. No plano de entrada, são 1.000 respostas/mês por menos do que
            o Typeform cobra por 100.
          </p>

          {/* Toggle */}
          <div className="inline-flex items-center gap-1 bg-slate-900 border border-white/10 rounded-full p-1 sm:p-1.5">
            <button
              onClick={() => setBilling('monthly')}
              className={`px-3 sm:px-5 py-2 rounded-full text-xs sm:text-sm font-semibold transition-all ${
                billing === 'monthly'
                  ? 'bg-white text-slate-900 shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Mensal
            </button>
            <button
              onClick={() => setBilling('annual')}
              className={`relative px-3 sm:px-5 py-2 rounded-full text-xs sm:text-sm font-semibold transition-all flex items-center gap-1.5 sm:gap-2.5 ${
                billing === 'annual'
                  ? 'bg-[#F5B731] text-black shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Anual
              <span className={`text-[10px] sm:text-xs font-bold px-1.5 sm:px-2 py-0.5 rounded-full ${
                billing === 'annual'
                  ? 'bg-black/20 text-black'
                  : 'bg-[#F5B731]/20 text-[#F5B731]'
              }`}>
                Economize até 41%
              </span>
            </button>
          </div>
          {billing === 'annual' && (
            <p className="mt-3 text-sm text-[#4BB678]">
              ✓ Valores por mês, cobrados anualmente
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 px-1">
          {plans.map((plan) => {
            const price = billing === 'annual' ? plan.price.annual : plan.price.monthly
            const originalPrice = plan.price.monthly

            return (
              <motion.div
                key={plan.id}
                initial={reduce ? false : { opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.15 }}
                whileHover={{ y: -4, transition: { duration: 0.18, ease: 'easeOut' } }}
                transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
                className={`relative flex flex-col p-6 rounded-2xl border transition-colors duration-300 ${
                  plan.accent === 'popular'
                    ? 'bg-slate-900 border-[#F5B731]/60 shadow-xl shadow-[#F5B731]/15 ring-1 ring-[#F5B731]/20 mt-4 sm:mt-0'
                    : plan.accent === 'agency'
                      ? 'bg-slate-900 border-violet-400/50 shadow-xl shadow-violet-500/15 ring-1 ring-violet-400/20 mt-4 sm:mt-0'
                      : 'bg-slate-900/60 border-white/[0.08] hover:border-white/15'
                }`}
              >
                {plan.accent === 'popular' && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap z-10">
                    <Badge className="bg-[#F5B731] text-black font-bold border-0 px-3 shadow-lg shadow-[#F5B731]/30">
                      Mais Popular
                    </Badge>
                  </div>
                )}
                {plan.accent === 'agency' && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap z-10">
                    <Badge className="bg-violet-500 text-white font-bold border-0 px-3 shadow-lg shadow-violet-500/30">
                      Para agências
                    </Badge>
                  </div>
                )}
                <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                <p className="text-sm text-slate-500 mb-4">{plan.desc}</p>

                <div className="mb-4">
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

                <p
                  className={`text-sm font-bold mb-5 pb-4 border-b border-white/5 ${
                    plan.accent === 'popular'
                      ? 'text-[#F5B731]'
                      : plan.accent === 'agency'
                        ? 'text-violet-300'
                        : 'text-white'
                  }`}
                >
                  {plan.responses}
                </p>

                <ul className="space-y-2 mb-6 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                      <Check className="w-4 h-4 text-[#4BB678] mt-0.5 flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>

                <Link
                  href={
                    plan.id === 'free'
                      ? '/register'
                      : `/register?next=/checkout/${plan.id}&cycle=${billing === 'annual' ? 'yearly' : billing}`
                  }
                  className="block mt-auto"
                >
                  <Button
                    className={`w-full font-semibold ${
                      plan.accent === 'popular'
                        ? 'bg-[#F5B731] hover:bg-[#E8923A] text-black shadow-lg shadow-[#F5B731]/25'
                        : plan.accent === 'agency'
                          ? 'bg-violet-500 hover:bg-violet-400 text-white shadow-lg shadow-violet-500/25'
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

        <p className="text-center text-sm text-slate-500 mt-8">
          Pagamento por cartão de crédito, em reais. Garantia de 7 dias: devolvemos 100%, sem perguntas.
          Cancele quando quiser, sem multa.
        </p>
      </div>
    </section>
  )
}
