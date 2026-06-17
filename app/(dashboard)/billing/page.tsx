import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import { BillingPlans } from '@/components/billing-plans'
import { CheckoutSuccessOverlay } from '@/components/checkout-success-overlay'

export const dynamic = 'force-dynamic'

const PLAN_LABELS: Record<string, string> = {
  free: '🌱 Free',
  starter: '⚡ Starter',
  plus: '🚀 Plus',
  professional: '👑 Professional',
}

export default async function BillingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, plan_cycle, plan_status, responses_used, responses_limit, plan_expires_at')
    .eq('id', user.id)
    .single()

  const currentPlan = (profile?.plan as string) || 'free'
  const currentCycle = (profile?.plan_cycle as string) || null
  const planStatus = ((profile as { plan_status?: string | null } | null)?.plan_status) || null
  const usedResponses = profile?.responses_used ?? 0
  const planLimit = profile?.responses_limit ?? 100
  const planExpiresAt = profile?.plan_expires_at ? new Date(profile.plan_expires_at) : null
  // Exibição em BRT: a expiração é gravada como fim-de-dia BRT (02:59Z do dia seguinte) —
  // formatar em UTC mostraria um dia a mais.
  const cycleLabel = planExpiresAt
    ? planExpiresAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'long' })
    : '—'
  const expiresLabel = planExpiresAt
    ? planExpiresAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'long', year: 'numeric' })
    : '—'
  const cycleName = currentPlan === 'free' ? '' : currentCycle === 'YEARLY' ? ' Anual' : currentCycle === 'MONTHLY' ? ' Mensal' : ''
  const isCanceling = planStatus === 'canceling' && currentPlan !== 'free'

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <Suspense fallback={null}>
        <CheckoutSuccessOverlay />
      </Suspense>
      <div className="flex items-center gap-4 mb-8">
        <Link href="/forms">
          <Button variant="ghost" size="sm" className="min-h-[44px] min-w-[44px]">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Planos & Cobrança</h1>
          <p className="text-slate-500 mt-1">Gerencie seu plano e assinatura</p>
        </div>
      </div>

      {/* Uso atual */}
      <Card className="p-6 mb-8 bg-[#0F1629] border border-[#F5B731]/30 shadow-lg shadow-[#F5B731]/5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-white">Uso atual — Plano {currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)}{cycleName}</h2>
            <p className="text-sm text-slate-300 mt-0.5">
              {currentPlan === 'free'
                ? 'Plano gratuito — sem ciclo de cobrança'
                : isCanceling
                  ? `Plano cancelado — você mantém o acesso até ${expiresLabel}`
                  : `Ciclo reinicia em ${cycleLabel}`}
            </p>
          </div>
          <Badge className="bg-[#F5B731]/15 text-[#F5B731] font-semibold border border-[#F5B731]/30">
            {PLAN_LABELS[currentPlan] || currentPlan}
          </Badge>
        </div>
        <div>
          <div className="flex justify-between text-sm mb-1.5">
            <span className="text-slate-300">Respostas recebidas</span>
            <span className="font-semibold text-white">{usedResponses} / {planLimit}</span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2">
            <div
              className="bg-[#F5B731] h-2 rounded-full transition-all"
              style={{ width: `${Math.min((usedResponses / planLimit) * 100, 100)}%` }}
            />
          </div>
          <p className="text-xs text-slate-400 mt-1">{planLimit - usedResponses} respostas restantes este mês</p>
        </div>
      </Card>

      <BillingPlans currentPlan={currentPlan} currentCycle={currentCycle} planStatus={planStatus} />

      <p className="text-center text-sm text-slate-500 mt-8">
        Todos os planos incluem SSL, backups diários e suporte por WhatsApp.{' '}
        <a href="https://wa.me/5583999378937" target="_blank" rel="noopener noreferrer" className="text-[#F5B731] hover:underline">
          Dúvidas? Fale conosco
        </a>
      </p>
    </div>
  )
}
