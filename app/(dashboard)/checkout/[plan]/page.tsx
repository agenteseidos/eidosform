'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { PLAN_ORDER, normalizePlan } from '@/lib/plans'
import { Suspense, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'

const PAID_PLANS = PLAN_ORDER.filter((p) => p !== 'free')

interface CheckoutResponse {
  checkoutUrl?: string
  alreadySubscribed?: boolean
  error?: string
  code?: string
  settingsUrl?: string
  missingFieldLabels?: string[]
}

function CheckoutContent() {
  const { plan } = useParams<{ plan: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()

  const cycle = searchParams.get('cycle') ?? 'monthly'
  const normalized = normalizePlan(plan)
  const isValid = normalized !== 'free' && PAID_PLANS.includes(normalized)

  const [state, setState] = useState<'loading' | 'error' | 'already' | 'missing-billing'>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [missingFields, setMissingFields] = useState<string[]>([])
  const [settingsUrl, setSettingsUrl] = useState('/settings')

  useEffect(() => {
    if (!isValid) return

    let cancelled = false

    async function startCheckout() {
      try {
        const res = await fetch(`/api/checkout/${normalized}?cycle=${cycle}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const json: CheckoutResponse = await res.json()

        if (cancelled) return

        if (json.alreadySubscribed) {
          setState('already')
          return
        }

        if (json.code === 'MISSING_BILLING_FIELDS') {
          setState('missing-billing')
          setMissingFields(json.missingFieldLabels || [])
          setSettingsUrl(json.settingsUrl || '/settings')
          setErrorMsg(json.error || 'Complete seus dados de cobrança antes de continuar.')
          return
        }

        if (!res.ok || !json.checkoutUrl) {
          setState('error')
          setErrorMsg(json.error || 'Erro ao criar checkout. Tente novamente.')
          return
        }

        window.location.href = json.checkoutUrl
      } catch {
        if (cancelled) return
        setState('error')
        setErrorMsg('Falha de conexão. Tente novamente.')
      }
    }

    startCheckout()
    return () => { cancelled = true }
  }, [isValid, normalized, cycle])

  if (!isValid) {
    router.replace('/billing')
    return null
  }

  if (state === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-6 max-w-md px-6">
          <div className="flex justify-center">
            <Loader2 className="h-12 w-12 animate-spin text-[#F5B731]" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            Processando checkout…
          </h1>
          <p className="text-slate-500">Redirecionando para o checkout. Aguarde.</p>
        </div>
      </div>
    )
  }

  if (state === 'already') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-6 max-w-md px-6">
          <div className="text-5xl">🟡</div>
          <h1 className="text-2xl font-bold text-slate-900">
            Você já tem este plano
          </h1>
          <p className="text-slate-500">Você já possui uma assinatura ativa neste plano.</p>
          <Button
            onClick={() => router.push('/billing')}
            className="bg-slate-900 hover:bg-slate-800 text-white"
          >
            Voltar ao billing
          </Button>
        </div>
      </div>
    )
  }

  if (state === 'missing-billing') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-6 max-w-xl px-6">
          <div className="text-5xl">🧾</div>
          <h1 className="text-2xl font-bold text-slate-900">
            Complete seus dados de cobrança
          </h1>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900 text-left">
            <p className="font-medium mb-2">Faltam informações obrigatórias para abrir o checkout:</p>
            <ul className="list-disc pl-5 space-y-1">
              {missingFields.map((field) => (
                <li key={field}>{field}</li>
              ))}
            </ul>
          </div>
          <p className="text-slate-500">{errorMsg}</p>
          <div className="flex gap-3 justify-center flex-wrap">
            <Button onClick={() => router.push(settingsUrl)} className="bg-slate-900 hover:bg-slate-800 text-white">
              Ir para configurações
            </Button>
            <Button variant="outline" onClick={() => router.push('/billing')}>
              Voltar ao billing
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center space-y-6 max-w-md px-6">
        <div className="text-5xl">❌</div>
        <h1 className="text-2xl font-bold text-slate-900">
          Erro no checkout
        </h1>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          {errorMsg}
        </div>
        <div className="flex gap-3 justify-center">
          <Button
            onClick={() => window.location.reload()}
            className="bg-slate-900 hover:bg-slate-800 text-white"
          >
            Tentar novamente
          </Button>
          <Button
            variant="outline"
            onClick={() => router.push('/billing')}
          >
            Voltar ao billing
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center space-y-6 max-w-md px-6">
            <div className="flex justify-center">
              <Loader2 className="h-12 w-12 animate-spin text-[#F5B731]" />
            </div>
            <p className="text-slate-500">Carregando checkout…</p>
          </div>
        </div>
      }
    >
      <CheckoutContent />
    </Suspense>
  )
}
