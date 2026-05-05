"use client"

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Activity, FileText, Users } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const ICON_MAP: Record<string, React.ElementType> = {
  users: Users,
  forms: FileText,
  responses: Activity,
}

const HREF_MAP: Record<string, string> = {
  users: '/admin/users',
  forms: '/admin/forms',
  responses: '/admin/responses',
}

type MetricsResponse = {
  totalUsers: number
  totalForms: number
  totalResponses: number
}

type MetricItem = {
  key: string
  title: string
  valueKey: keyof MetricsResponse
}

export function AdminMetricsCards({ items }: { items: MetricItem[] }) {
  const [data, setData] = useState<MetricsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadMetrics() {
      try {
        setLoading(true)
        setError(null)

        const response = await fetch('/api/admin/metrics', { cache: 'no-store' })
        if (!response.ok) throw new Error('Falha ao carregar métricas')

        const json = await response.json() as MetricsResponse
        if (active) setData(json)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Falha ao carregar métricas')
      } finally {
        if (active) setLoading(false)
      }
    }

    loadMetrics()
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => {
        const Icon = ICON_MAP[item.key]
        const href = HREF_MAP[item.key]
        const value = data?.[item.valueKey] ?? 0

        const card = (
          <Card className="h-full border-slate-200 bg-white transition hover:border-blue-300 hover:shadow-md">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm font-medium text-slate-600">{item.title}</CardTitle>
              <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
                <Icon className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tracking-tight text-slate-900">
                {loading ? '—' : value.toLocaleString('pt-BR')}
              </div>
              {error ? (
                <p className="mt-2 text-sm text-red-600">{error}</p>
              ) : (
                <p className="mt-2 text-sm text-slate-500">
                  {href ? 'Clique para ver detalhes' : 'Resumo em tempo real via API administrativa.'}
                </p>
              )}
            </CardContent>
          </Card>
        )

        return href ? (
          <Link key={item.key} href={href} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-xl">
            {card}
          </Link>
        ) : (
          <div key={item.key}>{card}</div>
        )
      })}
    </div>
  )
}
