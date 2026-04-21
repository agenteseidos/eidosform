'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { PLAN_ORDER, normalizePlan } from '@/lib/plans'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Check, Loader2 } from 'lucide-react'

const PAID_PLANS = PLAN_ORDER.filter((p) => p !== 'free')

interface CheckoutResponse {
  subscriptionId?: string
  status?: string
  value?: number
  cycle?: string
  plan?: string
  message?: string
  paymentHint?: string
  alreadySubscribed?: boolean
  error?: string
}

export default function CheckoutPage() {
  const { plan } = useParams<{ plan: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()

  const cycle = searchParams.get('cycle') ?? 'monthly'
  const normalized = normalizePlan(plan)
  const isValid = normalized !== 'free' && PAID_PLANS.includes(normalized)

  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error' | 'already'>('idle')
  const [data, setData] = useState<CheckoutResponse>({})
  const [cpfCnpj, setCpfCnpj] = useState('')
  const [validationError, setValidationError] = useState('')

  const startCheckout = useCallback(async () => {
    const raw = cpfCnpj.replace(/\D/g, '')
    if (raw.length !== 11 && raw.length !== 14) {
      setValidationError('Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).')
      return
    }
    setState('loading')
    setData({})
    setValidationError('')
    try {
      const res = await fetch(`/api/checkout/${normalized}?cycle=${cycle}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpfCnpj: raw }),
      })
      const json: CheckoutResponse = await res.json()
      setData(json)

      if (!res.ok) {
        setState('error')
        return
      }
      if (json.alreadySubscribed) {
        setState('already')
        return
      }
      setState('success')
    } catch {
      setState('error')
      setData({ error: 'Falha de conexão. Tente novamente.' })
    }
  }, [normalized, cycle, cpfCnpj])

  // CPF/CNPJ form — user submits manually

  if (!isValid) {
    router.replace('/billing')
    return null
  }

  const cycleLabel = cycle === 'yearly' ? 'Anual' : 'Mensal'

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center space-y-6 max-w-md px-6">
        {state === 'idle' && (
          <>
            <h1 className="text-2xl font-bold text-slate-900">
              Finalizar assinatura — {normalized.charAt(0).toUpperCase() + normalized.slice(1)} {cycleLabel}
            </h1>
            <p className="text-slate-500">
              Para criar sua assinatura, informe seu CPF ou CNPJ:
            </p>
            <div className="space-y-3 text-left">
              <label className="block text-sm font-medium text-slate-700">
                CPF ou CNPJ
              </label>
              <input
                type="text"
                inputMode="numeric"
                placeholder="000.000.000-00 ou 00.000.000/0001-00"
                value={cpfCnpj}
                onChange={(e) => {
                  setCpfCnpj(e.target.value)
                  setValidationError('')
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm focus:border-[#F5B731] focus:outline-none focus:ring-1 focus:ring-[#F5B731]"
                onKeyDown={(e) => { if (e.key === 'Enter') startCheckout() }}
              />
              {validationError && (
                <p className="text-sm text-red-600">{validationError}</p>
              )}
            </div>
            <Button
              onClick={startCheckout}
              className="bg-[#F5B731] hover:bg-[#e5a721] text-slate-900 font-semibold w-full"
            >
              Confirmar assinatura
            </Button>
            <Button
              variant="ghost"
              onClick={() => router.push('/billing')}
              className="text-slate-500"
            >
              Voltar ao billing
            </Button>
          </>
        )}

        {state === 'loading' && (
          <>
            <div className="flex justify-center">
              <Loader2 className="h-12 w-12 animate-spin text-[#F5B731]" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">
              Processando checkout…
            </h1>
            <p className="text-slate-500">Criando sua assinatura no Asaas. Aguarde.</p>
          </>
        )}

        {state === 'success' && (
          <>
            <div className="text-5xl">✅</div>
            <h1 className="text-2xl font-bold text-slate-900">
              Assinatura criada!
            </h1>
            <Badge className="bg-[#4BB678] text-white border-0 mx-auto">
              <Check className="w-3 h-3 mr-1" />
              {data.status?.toUpperCase()}
            </Badge>
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 text-left text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Plano</span>
                <span className="font-semibold capitalize">{data.plan}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Ciclo</span>
                <span className="font-semibold">{cycleLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Valor</span>
                <span className="font-semibold">
                  R$ {data.value?.toFixed(2).replace('.', ',')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">ID Assinatura</span>
                <span className="font-mono text-xs text-slate-400">{data.subscriptionId}</span>
              </div>
              <hr className="border-slate-100" />
              <p className="text-slate-600 leading-relaxed">{data.message}</p>
              {data.paymentHint && (
                <p className="text-slate-500 text-xs italic">{data.paymentHint}</p>
              )}
            </div>
            <Button
              onClick={() => router.push('/billing')}
              className="bg-slate-900 hover:bg-slate-800 text-white"
            >
              Voltar ao billing
            </Button>
          </>
        )}

        {state === 'already' && (
          <>
            <div className="text-5xl">🟡</div>
            <h1 className="text-2xl font-bold text-slate-900">
              Você já tem este plano
            </h1>
            <p className="text-slate-500">{data.message}</p>
            <Button
              onClick={() => router.push('/billing')}
              className="bg-slate-900 hover:bg-slate-800 text-white"
            >
              Voltar ao billing
            </Button>
          </>
        )}

        {state === 'error' && (
          <>
            <div className="text-5xl">❌</div>
            <h1 className="text-2xl font-bold text-slate-900">
              Erro no checkout
            </h1>
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
              {data.error}
            </div>
            <div className="flex gap-3 justify-center">
              <Button
                onClick={startCheckout}
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
          </>
        )}
      </div>
    </div>
  )
}
