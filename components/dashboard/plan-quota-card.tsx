'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PLANS, type PlanName } from '@/lib/plan-definitions'
import { Zap, Loader2, AlertCircle } from 'lucide-react'

interface PlanQuotaCardProps {
  formsUsed: number
}

interface PlanFeaturesResponse {
  plan: PlanName
  quota?: {
    responsesUsed: number
    responsesLimit: number
  }
  features?: {
    maxForms: number
  }
}

export function PlanQuotaCard({ formsUsed }: PlanQuotaCardProps) {
  const [data, setData] = useState<{
    planName: PlanName
    responsesUsed: number
    responsesLimit: number
    maxForms: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/user/plan-features', { cache: 'no-store' })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((body: PlanFeaturesResponse) => {
        setData({
          planName: body.plan ?? 'free',
          responsesUsed: body.quota?.responsesUsed ?? 0,
          responsesLimit: body.quota?.responsesLimit ?? 100,
          maxForms: body.features?.maxForms ?? PLANS.free.maxForms,
        })
      })
      .catch(err => {
        console.error('[PlanQuotaCard] Error fetching plan-features:', err)
        setError('Erro ao carregar informações do plano')
      })
  }, [])

  if (error) {
    return (
      <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4 flex items-center gap-3">
        <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
        <span className="text-sm text-red-700">{error}</span>
        <button
          onClick={() => window.location.reload()}
          className="ml-auto text-xs font-medium text-red-600 underline hover:text-red-800"
        >
          Tentar novamente
        </button>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="mb-6 rounded-xl border border-slate-200 bg-white px-5 py-4 flex items-center justify-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
        <span className="text-sm text-slate-400">Carregando…</span>
      </div>
    )
  }

  const { planName, responsesUsed, responsesLimit, maxForms } = data
  const plan = PLANS[planName] ?? PLANS.free
  const formsLimit = plan.maxForms ?? maxForms
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
