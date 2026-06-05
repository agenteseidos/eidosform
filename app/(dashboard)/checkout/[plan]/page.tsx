'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { PLAN_ORDER, normalizePlan } from '@/lib/plans'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { BillingFieldsDialog } from '@/components/billing/billing-fields-dialog'
import { createClient } from '@/lib/supabase/client'

const PAID_PLANS = PLAN_ORDER.filter((p) => p !== 'free')

interface CheckoutResponse {
  checkoutUrl?: string
  alreadySubscribed?: boolean
  error?: string
  code?: string
  settingsUrl?: string
  missingFields?: string[]
  missingFieldLabels?: string[]
  status?: string
  coveredByCredit?: boolean
  isDowngrade?: boolean
  creditCoverageDays?: number
  nextChargeDate?: string
}

type ProfileFields = {
  fullName: string
  email: string
  phone: string
  cpfCnpj: string
  address: string
  addressNumber: string
  complement: string
  postalCode: string
  province: string
  city: string
  state: string
}

const EMPTY_PROFILE: ProfileFields = {
  fullName: '', email: '', phone: '', cpfCnpj: '',
  address: '', addressNumber: '', complement: '',
  postalCode: '', province: '', city: '', state: '',
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
  const [profileData, setProfileData] = useState<ProfileFields>(EMPTY_PROFILE)
  const [dialogOpen, setDialogOpen] = useState(false)
  const cancelRef = useRef(false)

  const loadProfile = useCallback(async () => {
    const supabase = createClient()
    const { data: authData } = await supabase.auth.getUser()
    const userId = authData.user?.id
    if (!userId) return
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, email, phone, cpf_cnpj, address, address_number, complement, postal_code, province, city, state')
      .eq('id', userId)
      .single()
    if (!profile) return
    setProfileData({
      fullName: profile.full_name ?? '',
      email: profile.email ?? authData.user?.email ?? '',
      phone: profile.phone ?? '',
      cpfCnpj: profile.cpf_cnpj ?? '',
      address: profile.address ?? '',
      addressNumber: profile.address_number ?? '',
      complement: (profile as Record<string, string | null>).complement ?? '',
      postalCode: profile.postal_code ?? '',
      province: profile.province ?? '',
      city: profile.city ?? '',
      state: profile.state ?? '',
    })
  }, [])

  const startCheckout = useCallback(async () => {
    if (cancelRef.current) return
    setState('loading')
    try {
      const res = await fetch(`/api/checkout/${normalized}?cycle=${cycle}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json: CheckoutResponse = await res.json()
      if (cancelRef.current) return

      if (json.alreadySubscribed) {
        setState('already')
        return
      }

      if (json.code === 'MISSING_BILLING_FIELDS') {
        setMissingFields(json.missingFields || [])
        setErrorMsg(json.error || 'Complete seus dados de cobrança antes de continuar.')
        await loadProfile()
        setState('missing-billing')
        setDialogOpen(true)
        return
      }

      // Crédito cobriu o novo plano (Caminho D): plano ativado direto, SEM checkout.
      // Reusa a tela de sucesso do billing (overlay) em vez de mostrar erro.
      if (json.coveredByCredit || (res.ok && json.status === 'success' && !json.checkoutUrl)) {
        window.location.href = '/billing?checkout=success'
        return
      }

      // Downgrade: processado ao fim do período (informativo, sem checkout).
      if (json.isDowngrade) {
        window.location.href = '/billing'
        return
      }

      if (!res.ok || !json.checkoutUrl) {
        setState('error')
        setErrorMsg(json.error || 'Erro ao criar checkout. Tente novamente.')
        return
      }

      window.location.href = json.checkoutUrl
    } catch {
      if (cancelRef.current) return
      setState('error')
      setErrorMsg('Falha de conexão. Tente novamente.')
    }
  }, [normalized, cycle, loadProfile])

  useEffect(() => {
    if (!isValid) return
    cancelRef.current = false
    queueMicrotask(() => { startCheckout() })
    return () => { cancelRef.current = true }
  }, [isValid, startCheckout])

  if (!isValid) {
    router.replace('/billing')
    return null
  }

  if (state === 'already') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-6 max-w-md px-6">
          <div className="text-5xl">🟡</div>
          <h1 className="text-2xl font-bold text-slate-900">Você já tem este plano</h1>
          <p className="text-slate-500">Você já possui uma assinatura ativa neste plano.</p>
          <Button onClick={() => router.push('/billing')} className="bg-slate-900 hover:bg-slate-800 text-white">
            Voltar ao billing
          </Button>
        </div>
      </div>
    )
  }

  if (state === 'missing-billing') {
    return (
      <>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center space-y-4 max-w-md px-6">
            <Loader2 className="h-10 w-10 animate-spin text-amber-500 mx-auto" />
            <p className="text-slate-500">Aguardando seus dados de cobrança…</p>
            <Button variant="outline" onClick={() => setDialogOpen(true)} className="text-slate-700">
              Reabrir formulário
            </Button>
          </div>
        </div>
        <BillingFieldsDialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open)
            if (!open) router.push('/billing')
          }}
          initialData={profileData}
          missingFields={missingFields}
          onSaved={() => {
            setDialogOpen(false)
            startCheckout()
          }}
        />
      </>
    )
  }

  if (state === 'error') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-6 max-w-md px-6">
          <div className="text-5xl">❌</div>
          <h1 className="text-2xl font-bold text-slate-900">Erro no checkout</h1>
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{errorMsg}</div>
          <div className="flex gap-3 justify-center">
            <Button onClick={() => window.location.reload()} className="bg-slate-900 hover:bg-slate-800 text-white">
              Tentar novamente
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
        <Loader2 className="h-12 w-12 animate-spin text-[#F5B731] mx-auto" />
        <h1 className="text-2xl font-bold text-slate-900">Processando checkout…</h1>
        <p className="text-slate-500">Redirecionando para o checkout. Aguarde.</p>
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
