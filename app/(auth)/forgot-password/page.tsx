'use client'

export const dynamic = 'force-dynamic'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EidosLogo } from '@/components/ui/eidos-logo'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import Link from 'next/link'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) {
      toast.error('Insira seu e-mail')
      return
    }

    setIsLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    })

    if (error) {
      toast.error('Falha ao enviar link de recuperação')
    }
    // Always show success message to prevent email enumeration
    setSent(true)
    setIsLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-[#0a0a0a]">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(245, 183, 49, 0.08) 0%, transparent 50%)',
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md px-6 sm:px-8 relative z-10"
      >
        <div className="text-center mb-8">
          <div className="flex justify-center">
            <EidosLogo variant="full" theme="dark" href="/" height={40} />
          </div>
          <p className="mt-3 text-slate-400">Recupere o acesso à sua conta</p>
        </div>

        <div className="bg-[#111111] rounded-2xl shadow-xl shadow-black/20 p-8 border border-white/5">
          {sent ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center"
            >
              <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-[#4BB678]/10 border border-[#4BB678]/20 flex items-center justify-center">
                <svg className="w-8 h-8 text-[#4BB678]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-white mb-2">E-mail enviado</h2>
              <p className="text-slate-400 text-sm">
                Se este e-mail estiver cadastrado, enviaremos um link de recuperação.
                Verifique sua caixa de entrada.
              </p>
            </motion.div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-slate-300">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="voce@exemplo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  className="h-12 text-base bg-[#1a1a1a] border-white/10 text-white placeholder:text-slate-500 focus:border-[#F5B731] focus:ring-[#F5B731]/20"
                />
              </div>
              <Button
                type="submit"
                disabled={isLoading}
                className="w-full h-12 text-base font-medium bg-[#F5B731] hover:bg-[#E8923A] text-black shadow-lg shadow-[#F5B731]/20 transition-all"
              >
                {isLoading ? 'Enviando...' : 'Enviar link de recuperação'}
              </Button>
            </form>
          )}

          <Link
            href="/login"
            className="block mt-6 text-center text-sm text-[#F5B731] hover:text-[#E8923A] transition-colors"
          >
            Voltar para login
          </Link>
        </div>
      </motion.div>
    </div>
  )
}
