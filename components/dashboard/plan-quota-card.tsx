import Link from 'next/link'
import { PLANS, type PlanName } from '@/lib/plan-definitions'
import { Zap } from 'lucide-react'

interface PlanQuotaCardProps {
  planName: PlanName
  responsesUsed: number
  responsesLimit: number
  formsUsed: number
}

export function PlanQuotaCard({ planName, responsesUsed, responsesLimit, formsUsed }: PlanQuotaCardProps) {
  const plan = PLANS[planName] ?? PLANS.free
  const formsLimit = plan.maxForms
  const unlimited = responsesLimit === -1

  const responsePct = unlimited ? 0 : Math.min(100, Math.round((responsesUsed / responsesLimit) * 100))
  const showUpsell = !unlimited && responsePct >= 80

  const barColor = responsePct >= 90 ? '#EF4444' : responsePct >= 80 ? '#F59E0B' : '#3B82F6'

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white px-5 py-4 flex flex-wrap items-center gap-x-6 gap-y-3">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 border border-blue-100">
        {plan.name}
      </span>

      <div className="flex items-center gap-3 min-w-0">
        <span className="text-xs text-slate-500 whitespace-nowrap">Respostas</span>
        {unlimited ? (
          <span className="text-sm font-semibold text-slate-800">Ilimitadas</span>
        ) : (
          <div className="flex items-center gap-2">
            <div className="w-24 h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${responsePct}%`, backgroundColor: barColor }}
              />
            </div>
            <span className="text-sm font-semibold tabular-nums text-slate-800">
              {responsesUsed}/{responsesLimit}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500 whitespace-nowrap">Formulários</span>
        <span className="text-sm font-semibold tabular-nums text-slate-800">
          {formsUsed}/{formsLimit === -1 ? '∞' : formsLimit}
        </span>
      </div>

      {showUpsell && (
        <Link
          href="/billing"
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors whitespace-nowrap"
        >
          <Zap className="w-3.5 h-3.5" />
          Fazer upgrade
        </Link>
      )}
    </div>
  )
}
