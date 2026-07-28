'use client'

/**
 * Painel de análises do formulário — a "última milha" da auditoria LP
 * (2026-07-28): o endpoint /api/forms/[id]/analytics existia completo
 * (abandono por pergunta + tempo médio, gated Plus+ via partialResponses),
 * mas NENHUMA tela o consumia — o cliente pagava pela feature e não tinha
 * onde vê-la. Barras em CSS puro, sem lib de gráfico (decisão da Fase 3:
 * não inchar o bundle por barras horizontais).
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BarChart3, Clock3, Lock, TrendingDown } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface AbandonmentRow {
  question_id: string
  question_title: string
  question_index: number
  abandoned_count: number
  abandonment_rate: number
}

interface AnalyticsData {
  form_id: string
  total_responses: number
  completed_responses: number
  completion_rate: number
  avg_completion_time_seconds: number | null
  abandonment_by_question: AbandonmentRow[]
  plan_gated: boolean
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rest = s % 60
  if (m < 60) return rest > 0 ? `${m}min ${rest}s` : `${m}min`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}min`
}

export function AnalyticsPanel({ formId }: { formId: string }) {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/forms/${formId}/analytics`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: AnalyticsData) => { if (!cancelled) setData(json) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [formId])

  if (loading) {
    return (
      <Card className="p-6 mb-8">
        <div className="h-4 w-56 bg-slate-100 rounded animate-pulse mb-4" />
        <div className="space-y-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-8 bg-slate-50 rounded animate-pulse" />
          ))}
        </div>
      </Card>
    )
  }

  // Falha de rede/500: painel some em silêncio — a página de respostas segue
  // 100% funcional sem ele (analytics é complemento, não bloqueio).
  if (error || !data) return null

  // Plano sem a feature (free/starter): upsell honesto no lugar do gráfico.
  if (data.plan_gated) {
    return (
      <Card className="p-6 mb-8 bg-slate-50 border-dashed">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
              <TrendingDown className="w-5 h-5 text-violet-600" />
            </span>
            <div>
              <p className="font-semibold text-slate-700 flex items-center gap-2">
                Abandono por pergunta
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Plus+</Badge>
              </p>
              <p className="text-sm text-slate-500 mt-0.5 max-w-md">
                Veja a pergunta exata onde os leads desistem e o tempo médio de
                preenchimento — e ajuste o formulário antes de queimar mais tráfego.
              </p>
            </div>
          </div>
          <Link href="/billing">
            <Button size="sm" variant="outline" className="whitespace-nowrap">
              <Lock className="w-4 h-4 mr-2" />Liberar no Plus
            </Button>
          </Link>
        </div>
      </Card>
    )
  }

  const rows = data.abandonment_by_question
  const maxCount = Math.max(0, ...rows.map((r) => r.abandoned_count))
  const totalAbandoned = rows.reduce((acc, r) => acc + r.abandoned_count, 0)

  return (
    <Card className="p-6 mb-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2.5">
          <BarChart3 className="w-5 h-5 text-violet-600" />
          <h2 className="font-semibold text-slate-900">Abandono por pergunta</h2>
        </div>
        {data.avg_completion_time_seconds != null && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Clock3 className="w-4 h-4" />
            Tempo médio de preenchimento:
            <span className="font-semibold text-slate-700">
              {formatSeconds(data.avg_completion_time_seconds)}
            </span>
          </div>
        )}
      </div>

      {totalAbandoned === 0 ? (
        <p className="text-sm text-slate-500 py-2">
          Nenhum abandono registrado ainda. Quando um lead parar no meio, você
          verá aqui exatamente em qual pergunta ele desistiu.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const isWorst = maxCount > 0 && row.abandoned_count === maxCount
            // Largura relativa ao pior ponto — compara perguntas entre si
            // (a taxa absoluta segue visível no rótulo).
            const width = maxCount > 0 ? Math.round((row.abandoned_count / maxCount) * 100) : 0
            return (
              <div key={row.question_id} className="flex items-center gap-3">
                <span className="w-6 text-xs text-slate-400 font-medium text-right flex-shrink-0">
                  {row.question_index}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-sm text-slate-700 truncate" title={row.question_title}>
                      {row.question_title}
                    </p>
                    <span className={`text-xs font-semibold flex-shrink-0 ${
                      isWorst ? 'text-amber-600' : 'text-slate-500'
                    }`}>
                      {row.abandoned_count} {row.abandoned_count === 1 ? 'abandono' : 'abandonos'}
                      {' '}· {row.abandonment_rate}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        isWorst ? 'bg-amber-500' : 'bg-violet-400'
                      }`}
                      style={{ width: `${Math.max(width, row.abandoned_count > 0 ? 4 : 0)}%` }}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
