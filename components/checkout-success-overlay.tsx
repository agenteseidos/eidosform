'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { CheckCircle2, ArrowRight, AlertCircle, Clock3, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { motion, AnimatePresence } from 'framer-motion'

export function CheckoutSuccessOverlay() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)
  const [resolvedStatus, setResolvedStatus] = useState<string | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const consecutiveErrorsRef = useRef(0)

  const status = useMemo(() => searchParams.get('checkout'), [searchParams])

  useEffect(() => {
    let mounted = true
    let pollTimer: ReturnType<typeof setInterval> | undefined

    async function checkStatus(): Promise<string> {
      try {
        const res = await fetch('/api/checkout/status', { cache: 'no-store' })
        // 429 (rate limit) é transitório: segue tentando, não conta como erro fatal.
        if (res.status === 429) return 'pending'
        const data = await res.json()
        consecutiveErrorsRef.current = 0
        return (data.status as string) ?? 'pending'
      } catch {
        consecutiveErrorsRef.current += 1
        return 'error'
      }
    }

    async function resolveStatus() {
      if (status === 'cancelled' || status === 'expired') {
        if (!mounted) return
        setResolvedStatus(status)
        setVisible(true)
        window.history.replaceState({}, '', '/billing')
        return
      }

      if (status === 'success') {
        if (!mounted) return
        setIsPolling(true)
        setVisible(true)
        window.history.replaceState({}, '', '/billing')

        const POLL_INTERVAL = 4000 // ~15 req/min — folga sob o limite de 30/min do servidor
        const MAX_POLL_MS = 240_000 // 4 min de tolerância (webhook pode atrasar)
        const MAX_CONSECUTIVE_ERRORS = 3
        const start = Date.now()

        // First check
        const firstStatus = await checkStatus()
        if (!mounted) return
        if (firstStatus === 'success') {
          setIsPolling(false)
          setResolvedStatus('success')
          router.refresh()
          return
        }
        if (firstStatus === 'cancelled' || firstStatus === 'expired') {
          setIsPolling(false)
          setResolvedStatus(firstStatus)
          router.refresh()
          return
        }

        // Start polling
        pollTimer = setInterval(async () => {
          if (!mounted) return
          if (Date.now() - start >= MAX_POLL_MS) {
            clearInterval(pollTimer)
            setIsPolling(false)
            setResolvedStatus('pending')
            return
          }
          const s = await checkStatus()
          if (!mounted) return
          if (s === 'success') {
            clearInterval(pollTimer)
            setIsPolling(false)
            setResolvedStatus('success')
            router.refresh()
            return
          }
          if (s === 'cancelled' || s === 'expired') {
            clearInterval(pollTimer)
            setIsPolling(false)
            setResolvedStatus(s)
            router.refresh()
            return
          }
          // Too many consecutive fetch errors → stop polling, show degraded state
          if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_ERRORS) {
            clearInterval(pollTimer)
            setIsPolling(false)
            setResolvedStatus('network_error')
            return
          }
        }, POLL_INTERVAL)
      }
    }

    resolveStatus()

    // Rede de segurança: se o usuário sair e voltar pra aba (ou a janela de polling
    // expirar), re-checa uma vez ao reganhar foco e confirma se o pagamento já passou.
    async function recheckOnFocus() {
      if (!mounted || document.visibilityState !== 'visible') return
      if (status !== 'success') return // só no fluxo de retorno do checkout
      const s = await checkStatus()
      if (!mounted) return
      if (s === 'success') {
        if (pollTimer) clearInterval(pollTimer)
        setIsPolling(false)
        setResolvedStatus('success')
        router.refresh()
      }
    }
    document.addEventListener('visibilitychange', recheckOnFocus)

    return () => {
      mounted = false
      if (pollTimer) clearInterval(pollTimer)
      document.removeEventListener('visibilitychange', recheckOnFocus)
    }
  }, [router, status])

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

    if (resolvedStatus === 'network_error') {
      return {
        icon: <WifiOff className="w-12 h-12 text-red-400" />,
        iconWrap: 'bg-red-500/15',
        title: 'Erro de conexão',
        description: 'Não conseguimos verificar seu pagamento devido a um problema de conexão. Tente recarregar a página em instantes.',
        buttonLabel: 'Recarregar',
        buttonAction: 'reload' as const,
      }
    }

    // Polling / waiting state
    if (isPolling) {
      return {
        icon: <Clock3 className="w-12 h-12 text-[#F5B731] animate-pulse" />,
        iconWrap: 'bg-[#F5B731]/15',
        title: 'Aguardando confirmação do pagamento…',
        description: 'Estamos processando seu pagamento. Isso pode levar alguns instantes.',
        buttonLabel: 'Voltar ao EidosForm',
      }
    }

    return {
      icon: <Clock3 className="w-12 h-12 text-slate-300" />,
      iconWrap: 'bg-slate-500/15',
      title: 'Pagamento ainda não confirmado',
      description: 'Seu checkout foi encerrado, mas não encontramos confirmação de pagamento ainda. Seu plano atual continua o mesmo. Tente recarregar a página em instantes.',
      buttonLabel: 'Voltar ao EidosForm',
    }
  }, [isPolling, resolvedStatus])

  const handleRedirect = () => {
    if (content.buttonAction === 'reload') {
      router.refresh()
      return
    }

    if (resolvedStatus === 'success' && pathname === '/billing') {
      setVisible(false)
      router.refresh()
      return
    }

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
