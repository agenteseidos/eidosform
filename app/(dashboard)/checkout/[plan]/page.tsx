'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { PLAN_ORDER, normalizePlan } from '@/lib/plans'

const PAID_PLANS = PLAN_ORDER.filter((p) => p !== 'free')

export default function CheckoutPage() {
  const { plan } = useParams<{ plan: string }>()
  const router = useRouter()

  const normalized = normalizePlan(plan)
  const isValid = normalized !== 'free' && PAID_PLANS.includes(normalized)

  useEffect(() => {
    if (!isValid) {
      router.replace('/billing')
      return
    }

    const timer = setTimeout(() => {
      router.replace('/billing')
    }, 2000)

    return () => clearTimeout(timer)
  }, [isValid, router])

  if (!isValid) return null

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center space-y-4">
        <div className="text-4xl animate-pulse">💳</div>
        <h1 className="text-2xl font-bold text-slate-900">
          Processando upgrade para{' '}
          <span className="capitalize">{normalized}</span>...
        </h1>
        <p className="text-slate-500">
          Você será redirecionado em instantes.
        </p>
      </div>
    </div>
  )
}
