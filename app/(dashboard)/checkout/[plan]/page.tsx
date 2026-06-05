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

interface PreviewResponse {
  action: 'already_subscribed' | 'downgrade_scheduled' | 'credit_covered' | 'checkout'
  currentPlan: string
  currentCycle: string | null
  newPlan: string
  newCycle: string
  proration: { credit: number; originalPrice: number; finalPrice: number } | null
  amountDueNow: number
  coveredByCredit: boolean
  creditCoverageDays: number | null
  nextChargeDate: string | null
  missingFields?: string[]
  error?: string
}

const brl = (n: number) => `R$ ${Number(n ?? 0).toFixed(2).replace('.', ',')}`
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
const cycleLabel = (c: string | null | undefined) => (c?.toUpperCase() === 'YEARLY' ? 'Anual' : 'Mensal')
const fmtDate = (d: string | null) => {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
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

  const [state, setState] = useState<'loading' | 'error' | 'already' | 'missing-billing' | 'confirm' | 'downgrade'>('loading')
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [missingFields, setMissingFields] = useState<string[]>([])
  const [profileData, setProfileData] = useState<ProfileFields>(EMPTY_PROFILE)
  const [dialogOpen, setDialogOpen] = useState(false)
  const cancelRef = useRef(false)
  const submittingRef = useRef(false)

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
    // Guard de duplo clique: dois cliques rápidos no "Confirmar" criariam dois checkouts.
    if (cancelRef.current || submittingRef.current) return
    submittingRef.current = true
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
    } finally {
      submittingRef.current = false
    }
  }, [normalized, cycle, loadProfile])

  const loadPreview = useCallback(async () => {
    if (cancelRef.current) return
    setState('loading')
    try {
      const res = await fetch(`/api/checkout/${normalized}/preview?cycle=${cycle}`, { cache: 'no-store' })
      const json: PreviewResponse = await res.json()
      if (cancelRef.current) return

      if (!res.ok) {
        setState('error')
        setErrorMsg(json.error || 'Não foi possível carregar o resumo da mudança.')
        return
      }

      if (json.missingFields && json.missingFields.length > 0) {
        setMissingFields(json.missingFields)
        await loadProfile()
        setState('missing-billing')
        setDialogOpen(true)
        return
      }

      if (json.action === 'already_subscribed') { setState('already'); return }
      if (json.action === 'downgrade_scheduled') { setPreview(json); setState('downgrade'); return }

      // Primeira compra (free → pago): vai direto pro checkout (a página do Asaas confirma).
      if (json.currentPlan === 'free') { startCheckout(); return }

      // Troca de plano (já assinante): mostrar tela de confirmação ANTES de executar.
      setPreview(json)
      setState('confirm')
    } catch {
      if (cancelRef.current) return
      setState('error')
      setErrorMsg('Falha de conexão. Tente novamente.')
    }
  }, [normalized, cycle, loadProfile, startCheckout])

  useEffect(() => {
    if (!isValid) return
    cancelRef.current = false
    queueMicrotask(() => { loadPreview() })
    return () => { cancelRef.current = true }
  }, [isValid, loadPreview])

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
            // Volta pro PREVIEW (não executa direto): numa troca de plano, isso reexibe a
            // tela de confirmação. loadPreview já manda 1ª compra (free) direto pro checkout.
            loadPreview()
          }}
        />
      </>
    )
  }

  if (state === 'confirm' && preview) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-full max-w-md px-6 space-y-6">
          <h1 className="text-2xl font-bold text-slate-900 text-center">Confirmar mudança de plano</h1>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-2.5 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Plano atual</span>
              <span className="text-slate-900">{cap(preview.currentPlan)} · {cycleLabel(preview.currentCycle)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Novo plano</span>
              <span className="font-semibold text-slate-900">{cap(preview.newPlan)} · {cycleLabel(preview.newCycle)}</span>
            </div>
            {preview.proration && preview.proration.credit > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-500">Crédito do plano atual</span>
                <span className="text-emerald-600">− {brl(preview.proration.credit)}</span>
              </div>
            )}
            <div className="border-t border-slate-200 my-1" />
            <div className="flex justify-between text-base">
              <span className="text-slate-700 font-medium">A pagar agora</span>
              <span className="font-bold text-slate-900">{preview.coveredByCredit ? 'R$ 0,00' : brl(preview.amountDueNow)}</span>
            </div>
            {preview.coveredByCredit && (
              <p className="text-slate-500 text-xs pt-1">
                Seu crédito cobre esta mudança — você não paga nada agora. A próxima cobrança de {brl(preview.proration?.originalPrice ?? 0)} será em {fmtDate(preview.nextChargeDate)}.
              </p>
            )}
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => router.push('/billing')} className="flex-1">
              Cancelar
            </Button>
            <Button onClick={() => startCheckout()} className="flex-1 bg-[#F5B731] hover:bg-[#F5B731]/90 text-black font-semibold">
              Confirmar
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (state === 'downgrade') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-6 max-w-md px-6">
          <div className="text-5xl">🗓️</div>
          <h1 className="text-2xl font-bold text-slate-900">Mudança agendada</h1>
          <p className="text-slate-500">Mudanças para um plano menor são processadas ao final do seu período atual. Seu plano continua o mesmo até lá.</p>
          <Button onClick={() => router.push('/billing')} className="bg-slate-900 hover:bg-slate-800 text-white">
            Voltar ao billing
          </Button>
        </div>
      </div>
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
