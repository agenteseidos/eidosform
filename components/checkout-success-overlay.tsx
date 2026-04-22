'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { CheckCircle2, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { motion, AnimatePresence } from 'framer-motion'

export function CheckoutSuccessOverlay() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (searchParams.get('checkout') === 'success') {
      setVisible(true)
      // Clean the URL so refresh won't show the modal again
      window.history.replaceState({}, '', '/billing')
    }
  }, [searchParams])

  const handleRedirect = () => {
    router.push('/')
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
              <div className="rounded-full bg-emerald-500/15 p-4">
                <CheckCircle2 className="w-12 h-12 text-emerald-400" />
              </div>
            </div>

            <h2 className="text-2xl font-bold text-white mb-2">
              Pagamento confirmado!
            </h2>

            <p className="text-slate-400 mb-8 leading-relaxed">
              Sua assinatura foi ativada com sucesso.<br />
              Bem-vindo ao seu novo plano! 🎉
            </p>

            <Button
              onClick={handleRedirect}
              className="w-full bg-[#F5B731] hover:bg-[#F5B731]/90 text-black font-semibold h-12 rounded-xl text-base"
            >
              Voltar ao EidosForm
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
