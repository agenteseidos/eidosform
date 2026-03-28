'use client'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { EidosLogo } from '@/components/ui/eidos-logo'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { Mail } from 'lucide-react'

function VerifyEmailContent() {
  const searchParams = useSearchParams()
  const email = searchParams.get('email') || ''
  const [isResending, setIsResending] = useState(false)
  const supabase = createClient()

  const handleResend = async () => {
    if (!email) {
      toast.error('E-mail não encontrado')
      return
    }
    setIsResending(true)
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) {
      toast.error('Falha ao reenviar e-mail')
    } else {
      toast.success('E-mail reenviado!')
    }
    setIsResending(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-[#0a0a0a]">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(75, 182, 120, 0.08) 0%, transparent 50%)',
        }}
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md px-6 sm:px-8 text-center relative z-10"
      >
        <Link href="/login" className="fixed top-6 left-6 text-slate-400 hover:text-white transition-colors text-sm py-2 px-3 inline-flex items-center gap-1 z-20">← Voltar</Link>
        <div className="flex justify-center mb-8 pt-12">
          <EidosLogo variant="full" theme="dark" href="/" height={144} />
        </div>

        <div className="bg-[#111111] rounded-2xl shadow-xl shadow-black/20 p-8 border border-white/5">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-[#4BB678]/10 border border-[#4BB678]/20 flex items-center justify-center">
            <Mail className="w-8 h-8 text-[#4BB678]" />
          </div>

          <h1 className="text-2xl font-bold text-white mb-2">Verifique seu e-mail</h1>
          <p className="text-slate-400 mb-6">
            Enviamos um link de confirmação para{' '}
            {email ? <strong className="text-white">{email}</strong> : 'seu e-mail'}.
            Clique no link para ativar sua conta.
          </p>

          <Button
            onClick={handleResend}
            disabled={isResending}
            variant="outline"
            className="w-full h-12 text-base font-medium border border-white/10 bg-[#1a1a1a] hover:bg-[#222222] hover:border-white/20 text-white transition-all"
          >
            {isResending ? 'Reenviando...' : 'Reenviar e-mail'}
          </Button>

          <Link
            href="/login"
            className="block mt-4 text-sm text-[#F5B731] hover:text-[#E8923A] transition-colors"
          >
            Voltar para login
          </Link>
        </div>
      </motion.div>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  )
}
