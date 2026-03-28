'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { EidosLogo } from '@/components/ui/eidos-logo'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { Eye, EyeOff, Check, X } from 'lucide-react'

function getPasswordStrength(password: string): { score: number; label: string; color: string } {
  let score = 0
  if (password.length >= 8) score++
  if (password.length >= 12) score++
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++
  if (/\d/.test(password)) score++
  if (/[^a-zA-Z0-9]/.test(password)) score++

  if (score <= 1) return { score, label: 'Fraca', color: '#ef4444' }
  if (score <= 2) return { score, label: 'Razoável', color: '#E8923A' }
  if (score <= 3) return { score, label: 'Boa', color: '#F5B731' }
  return { score, label: 'Forte', color: '#4BB678' }
}

export default function RegisterPage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const supabase = createClient()
  const router = useRouter()

  const strength = getPasswordStrength(password)

  const handleGoogleLogin = async () => {
    setIsLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) {
      toast.error('Falha ao cadastrar com Google')
      setIsLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!fullName || !email || !password || !confirmPassword) {
      toast.error('Preencha todos os campos')
      return
    }
    if (password.length < 8) {
      toast.error('A senha deve ter no mínimo 8 caracteres')
      return
    }
    if (password !== confirmPassword) {
      toast.error('As senhas não coincidem')
      return
    }
    if (!acceptTerms) {
      toast.error('Você precisa aceitar os termos de uso')
      return
    }

    setIsLoading(true)
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      if (error.message.includes('already registered')) {
        toast.error('Este e-mail já está cadastrado')
      } else {
        toast.error('Falha ao criar conta. Tente novamente.')
      }
      setIsLoading(false)
    } else {
      router.push(`/verify-email?email=${encodeURIComponent(email)}`)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-[#0a0a0a]">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(245, 183, 49, 0.08) 0%, transparent 50%), radial-gradient(ellipse 50% 50% at 100% 100%, rgba(232, 146, 58, 0.06) 0%, transparent 50%)',
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md px-6 sm:px-8 py-8 relative z-10"
      >
        <Link href="/" className="fixed top-6 left-6 text-slate-400 hover:text-white transition-colors text-sm py-2 px-3 inline-flex items-center gap-1 z-20">← Voltar</Link>
        <div className="text-center mb-8 pt-12">
          <div className="flex justify-center">
            <EidosLogo variant="full" theme="dark" href="/" height={144} />
          </div>
          <p className="mt-3 text-slate-400">Crie sua conta gratuita</p>
        </div>

        <div className="bg-[#111111] rounded-2xl shadow-xl shadow-black/20 p-8 border border-white/5">
          <form onSubmit={handleRegister} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName" className="text-slate-300">Nome completo</Label>
              <Input
                id="fullName"
                type="text"
                placeholder="Seu nome"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                disabled={isLoading}
                className="h-12 text-base bg-[#1a1a1a] border-slate-500 text-white placeholder:text-slate-400 focus:border-[#F5B731] focus:ring-[#F5B731]/20"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="text-slate-300">E-mail</Label>
              <Input
                id="email"
                type="email"
                placeholder="voce@exemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                className="h-12 text-base bg-[#1a1a1a] border-slate-500 text-white placeholder:text-slate-400 focus:border-[#F5B731] focus:ring-[#F5B731]/20"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-slate-300">Senha</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Mínimo 8 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  className="h-12 text-base bg-[#1a1a1a] border-slate-500 text-white placeholder:text-slate-400 focus:border-[#F5B731] focus:ring-[#F5B731]/20 pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors w-11 h-11 flex items-center justify-center"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {password && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="space-y-1.5"
                >
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div
                        key={i}
                        className="h-1 flex-1 rounded-full transition-colors"
                        style={{
                          backgroundColor: i <= strength.score ? strength.color : '#333',
                        }}
                      />
                    ))}
                  </div>
                  <p className="text-xs" style={{ color: strength.color }}>
                    Senha {strength.label.toLowerCase()}
                  </p>
                </motion.div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-slate-300">Confirmar senha</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="Repita a senha"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isLoading}
                  className="h-12 text-base bg-[#1a1a1a] border-slate-500 text-white placeholder:text-slate-400 focus:border-[#F5B731] focus:ring-[#F5B731]/20 pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors w-11 h-11 flex items-center justify-center"
                >
                  {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {confirmPassword && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-1.5">
                  {password === confirmPassword ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#4BB678]" />
                      <span className="text-xs text-[#4BB678]">Senhas coincidem</span>
                    </>
                  ) : (
                    <>
                      <X className="w-3.5 h-3.5 text-red-400" />
                      <span className="text-xs text-red-400">Senhas não coincidem</span>
                    </>
                  )}
                </motion.div>
              )}
            </div>

            <div className="flex items-start gap-3 py-1">
              <input
                id="terms"
                type="checkbox"
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
                className="mt-1 h-5 w-5 rounded border-white/20 bg-[#1a1a1a] text-[#F5B731] focus:ring-[#F5B731]/20 accent-[#F5B731]"
              />
              <label htmlFor="terms" className="text-sm text-slate-400">
                Aceito os{' '}
                <Link href="/terms" className="text-[#F5B731] hover:text-[#E8923A] transition-colors py-2 inline-block">
                  termos de uso
                </Link>{' '}
                e a{' '}
                <Link href="/privacy" className="text-[#F5B731] hover:text-[#E8923A] transition-colors py-2 inline-block">
                  política de privacidade
                </Link>
              </label>
            </div>

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-12 text-base font-medium bg-[#F5B731] hover:bg-[#E8923A] text-black shadow-lg shadow-[#F5B731]/20 transition-all hover:shadow-[#E8923A]/30"
            >
              {isLoading ? (
                <span className="flex items-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Criando conta...
                </span>
              ) : (
                'Criar conta'
              )}
            </Button>
          </form>

          <div className="relative my-6">
            <Separator className="bg-slate-500" />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#111111] px-3 text-sm text-slate-500">
              ou
            </span>
          </div>

          <Button
            onClick={handleGoogleLogin}
            disabled={isLoading}
            variant="outline"
            className="w-full h-12 text-base font-medium border border-slate-500 bg-[#1a1a1a] hover:bg-[#222222] hover:border-white/30 text-white shadow-sm transition-all"
          >
            <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Cadastrar com Google
          </Button>
        </div>

        <p className="mt-6 pb-8 text-center text-sm text-slate-500">
          Já tem conta?{' '}
          <Link href="/login" className="text-[#F5B731] hover:text-[#E8923A] font-medium transition-colors py-2 inline-block">
            Entrar
          </Link>
        </p>
      </motion.div>
    </div>
  )
}
