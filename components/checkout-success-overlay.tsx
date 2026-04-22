'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { CheckCircle2, ArrowRight, AlertCircle, Clock3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { motion, AnimatePresence } from 'framer-motion'

export function CheckoutSuccessOverlay() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [visible, setVisible] = useState(false)
  const [resolvedStatus, setResolvedStatus] = useState<string | null>(null)

  const status = useMemo(() => searchParams.get('checkout'), [searchParams])

  useEffect(() => {
    let mounted = true

    async function resolveStatus() {
      if (status === 'cancelled' || status === 'expired') {
        if (!mounted) return
        setResolvedStatus(status)
        setVisible(true)
        window.history.replaceState({}, '', '/billing')
        return
      }

      if (status === 'success') {
        try {
          const res = await fetch('/api/checkout/status', { cache: 'no-store' })
          const data = await res.json()
          if (!mounted) return
          setResolvedStatus(data.status === 'success' ? 'success' : 'pending')
          setVisible(true)
          window.history.replaceState({}, '', '/billing')
          return
        } catch {
          if (!mounted) return
          setResolvedStatus('pending')
          setVisible(true)
          window.history.replaceState({}, '', '/billing')
          return
        }
      }
    }

    resolveStatus()
    return () => { mounted = false }
  }, [status])

  const content = useMemo(() => {
    if (resolvedStatus === 'cancelled') {
      return {
        icon: <AlertCircle className="w-12 h-12 text-amber-400" />,
        iconWrap: 'bg-amber-500/15',
        title: 'Checkout cancelado',
        description: 'Seu pagamento não foi concluído. Seu plano atual continua o mesmo.',
        buttonLabel: 'Voltar ao EidosForm',
      }
    }

    if (resolvedStatus === 'expired') {
      return {
        icon: <Clock3 className="w-12 h-12 text-amber-400" />,
        iconWrap: 'bg-amber-500/15',
        title: 'Checkout expirado',
        description: 'O tempo para concluir este pagamento terminou. Você pode iniciar um novo checkout quando quiser.',
        buttonLabel: 'Voltar ao EidosForm',
      }
    }

    if (resolvedStatus === 'success') {
      return {
        icon: <CheckCircle2 className="w-12 h-12 text-emerald-400" />,
        iconWrap: 'bg-emerald-500/15',
        title: 'Pagamento confirmado!',
        description: 'Sua assinatura foi ativada com sucesso. Bem-vindo ao seu novo plano! 🎉',
        buttonLabel: 'Voltar ao EidosForm',
      }
    }

    return {
      icon: <Clock3 className="w-12 h-12 text-slate-300" />,
      iconWrap: 'bg-slate-500/15',
      title: 'Pagamento ainda não confirmado',
      description: 'Seu checkout foi encerrado, mas não encontramos confirmação de pagamento. Seu plano atual continua o mesmo.',
      buttonLabel: 'Voltar ao EidosForm',
    }
  }, [resolvedStatus])

  const handleRedirect = () => {
    router.push('/forms')
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setVisible(false)
            }
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="mx-4 w-full max-w-md rounded-2xl bg-[#0F1629] border border-[#F5B731]/30 shadow-2xl shadow-[#F5B731]/10 p-8 text-center"
          >
            <div className="flex justify-center mb-5">
              <div className={`rounded-full p-4 ${content.iconWrap}`}>
                {content.icon}
              </div>
            </div>

            <h2 className="text-2xl font-bold text-white mb-2">
              {content.title}
            </h2>

            <p className="text-slate-400 mb-8 leading-relaxed">
              {content.description}
            </p>

            <Button
              onClick={handleRedirect}
              className="w-full bg-[#F5B731] hover:bg-[#F5B731]/90 text-black font-semibold h-12 rounded-xl text-base"
            >
              {content.buttonLabel}
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
