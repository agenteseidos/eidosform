import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import { BillingPlans } from '@/components/billing-plans'

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
    .select('plan, responses_used, responses_limit')
    .eq('id', user.id)
    .single()

  const currentPlan = (profile?.plan as string) || 'free'
  const usedResponses = profile?.responses_used ?? 0
  const planLimit = profile?.responses_limit ?? 100

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/dashboard">
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
            <h2 className="font-semibold">Uso atual — Plano {currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)}</h2>
            <p className="text-sm text-slate-500 mt-0.5">Ciclo reinicia em 1 de abril</p>
          </div>
          <Badge className="bg-[#F5B731]/15 text-[#F5B731] font-semibold border border-[#F5B731]/30">
            {PLAN_LABELS[currentPlan] || currentPlan}
          </Badge>
        </div>
        <div>
          <div className="flex justify-between text-sm mb-1.5">
            <span className="text-slate-400">Respostas recebidas</span>
            <span className="font-semibold">{usedResponses} / {planLimit}</span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2">
            <div
              className="bg-[#F5B731] h-2 rounded-full transition-all"
              style={{ width: `${Math.min((usedResponses / planLimit) * 100, 100)}%` }}
            />
          </div>
          <p className="text-xs text-slate-500 mt-1">{planLimit - usedResponses} respostas restantes este mês</p>
        </div>
      </Card>

      <BillingPlans currentPlan={currentPlan} />

      <p className="text-center text-sm text-slate-500 mt-8">
        Todos os planos incluem SSL, backups diários e suporte por e-mail.{' '}
        <a href="mailto:suporte@eidosform.com" className="text-[#F5B731] hover:underline">
          Dúvidas? Fale conosco
        </a>
      </p>
    </div>
  )
}
