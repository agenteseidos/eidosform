'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { PLAN_ORDER, normalizePlan } from '@/lib/plans'

const PAID_PLANS = PLAN_ORDER.filter((p) => p !== 'free')

export default function CheckoutPage() {
  const { plan } = useParams<{ plan: string }>()
  const router = useRouter()

  const normalized = normalizePlan(plan)
  const isValid = normalized !== 'free' && PAID_PLANS.includes(normalized)

  if (!isValid) {
    router.replace('/billing')
    return null
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center space-y-6 max-w-md px-6">
        <div className="text-5xl">💳</div>
        <h1 className="text-2xl font-bold text-slate-900">
          Upgrade para <span className="capitalize">{normalized}</span>
        </h1>
        <p className="text-slate-500 leading-relaxed">
          O pagamento é processado via <strong>Asaas</strong> para máxima segurança.
          Você será redirecionado para a página de pagamento assim que o checkout estiver disponível.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/billing"
            className="inline-flex items-center justify-center h-11 px-6 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors"
          >
            Voltar ao billing
          </Link>
          <a
            href="https://wa.me/5581999999999?text=Olá! Gostaria de fazer o upgrade do meu plano."
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center h-11 px-6 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            Entrar em contato
          </a>
        </div>
      </div>
    </div>
  )
}
