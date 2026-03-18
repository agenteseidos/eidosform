import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Check, Zap, Crown, Rocket, Sparkles } from 'lucide-react'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const plans = [
  {
    id: 'free',
    name: 'Free',
    emoji: '🌱',
    icon: Zap,
    price: { monthly: 0, annual: 0 },
    description: 'Para começar e testar',
    color: 'slate',
    limits: { responses: 100, forms: 3 },
    features: [
      '3 formulários ativos',
      '100 respostas/mês',
      'Templates básicos',
      'Compartilhamento por link',
      "Marca d'água EidosForm",
    ],
    cta: 'Plano atual',
    popular: false,
  },
  {
    id: 'starter',
    name: 'Starter',
    emoji: '⚡',
    icon: Rocket,
    price: { monthly: 49, annual: 29 },
    description: 'Para freelancers e pequenos negócios',
    color: 'blue',
    limits: { responses: 1000, forms: 10 },
    features: [
      '10 formulários ativos',
      '1.000 respostas/mês',
      'Todos os templates',
      'Exportar respostas (CSV)',
      'Notificações por e-mail',
    ],
    cta: 'Fazer upgrade',
    popular: false,
  },
  {
    id: 'plus',
    name: 'Plus',
    emoji: '🚀',
    icon: Sparkles,
    price: { monthly: 127, annual: 97 },
    description: 'Para equipes em crescimento',
    color: 'violet',
    limits: { responses: 10000, forms: 50 },
    features: [
      '50 formulários ativos',
      '10.000 respostas/mês',
      'Sem marca d\'água',
      'Domínio personalizado',
      'Lógica condicional avançada',
      'Webhooks e integrações',
      'Pixels de rastreamento',
      'Analytics avançado',
    ],
    cta: 'Fazer upgrade',
    popular: true,
  },
  {
    id: 'professional',
    name: 'Professional',
    emoji: '👑',
    icon: Crown,
    price: { monthly: 257, annual: 197 },
    description: 'Para empresas e agências',
    color: 'amber',
    limits: { responses: 100000, forms: 999 },
    features: [
      'Formulários ilimitados',
      '100.000 respostas/mês',
      'Sem marca d\'água',
      'White-label completo',
      'Acesso via API',
      'Suporte prioritário',
      'SSO / SAML',
      'SLA garantido',
    ],
    cta: 'Fazer upgrade',
    popular: false,
  },
]

const colorMap: Record<string, { border: string; button: string; bg: string; icon: string }> = {
  slate: {
    border: 'border-slate-200',
    button: 'bg-slate-100 text-slate-500 cursor-default',
    bg: 'bg-white',
    icon: 'text-slate-400',
  },
  blue: {
    border: 'border-blue-200',
    button: 'bg-blue-600 hover:bg-blue-700 text-white',
    bg: 'bg-blue-50/40',
    icon: 'text-blue-500',
  },
  violet: {
    border: 'border-violet-300',
    button: 'bg-violet-600 hover:bg-violet-700 text-white shadow-lg shadow-violet-500/30',
    bg: 'bg-gradient-to-br from-violet-50 to-purple-50',
    icon: 'text-violet-600',
  },
  amber: {
    border: 'border-amber-200',
    button: 'bg-amber-500 hover:bg-amber-600 text-white',
    bg: 'bg-amber-50/40',
    icon: 'text-amber-500',
  },
}

export default async function BillingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const currentPlan = 'free'
  const usedResponses = 23
  const planLimit = 100

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/dashboard">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Planos & Cobrança</h1>
          <p className="text-slate-600 mt-1">Gerencie seu plano e assinatura</p>
        </div>
      </div>

      {/* Uso atual */}
      <Card className="p-6 mb-8 border-slate-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-slate-900">Uso atual — Plano Free</h2>
            <p className="text-sm text-slate-500 mt-0.5">Ciclo reinicia em 1 de abril</p>
          </div>
          <Badge className="bg-slate-100 text-slate-700 font-medium">🌱 Free</Badge>
        </div>
        <div>
          <div className="flex justify-between text-sm mb-1.5">
            <span className="text-slate-600">Respostas recebidas</span>
            <span className="font-semibold text-slate-900">{usedResponses} / {planLimit}</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all"
              style={{ width: `${Math.min((usedResponses / planLimit) * 100, 100)}%` }}
            />
          </div>
          <p className="text-xs text-slate-400 mt-1">{planLimit - usedResponses} respostas restantes este mês</p>
        </div>
      </Card>

      {/* Cards de planos */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {plans.map((plan) => {
          const colors = colorMap[plan.color]
          const Icon = plan.icon
          const isCurrentPlan = plan.id === currentPlan

          return (
            <div
              key={plan.id}
              className={`relative rounded-2xl border-2 ${colors.border} ${colors.bg} p-6 flex flex-col ${
                plan.popular ? 'ring-2 ring-violet-500 ring-offset-2 shadow-xl' : ''
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap">
                  <span className="bg-violet-600 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg">
                    ✨ Mais Popular
                  </span>
                </div>
              )}

              <div className="mb-4">
                <div className={`w-10 h-10 rounded-xl border ${colors.border} flex items-center justify-center mb-3 bg-white/70`}>
                  <Icon className={`w-5 h-5 ${colors.icon}`} />
                </div>
                <h3 className="text-lg font-bold text-slate-900">{plan.emoji} {plan.name}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{plan.description}</p>
              </div>

              <div className="mb-5">
                {plan.price.monthly === 0 ? (
                  <div>
                    <span className="text-3xl font-black text-slate-900">Grátis</span>
                  </div>
                ) : (
                  <div>
                    <span className="text-3xl font-black text-slate-900">R${plan.price.monthly}</span>
                    <span className="text-sm text-slate-500">/mês</span>
                    <p className="text-xs text-slate-400 mt-0.5">
                      ou R${plan.price.annual}/mês anual
                    </p>
                  </div>
                )}
              </div>

              <ul className="space-y-2 mb-6 flex-1">
                {plan.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                    <Check className={`w-4 h-4 mt-0.5 flex-shrink-0 ${colors.icon}`} />
                    {feature}
                  </li>
                ))}
              </ul>

              <Button
                className={`w-full font-semibold transition-all ${colors.button}`}
                disabled={isCurrentPlan}
              >
                {isCurrentPlan ? '✓ Plano atual' : plan.cta}
              </Button>
            </div>
          )
        })}
      </div>

      <p className="text-center text-sm text-slate-400 mt-8">
        Todos os planos incluem SSL, backups diários e suporte por e-mail.{' '}
        <a href="mailto:suporte@eidosform.com.br" className="text-blue-600 hover:underline">
          Dúvidas? Fale conosco
        </a>
      </p>
    </div>
  )
}
