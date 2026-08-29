'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Eye, EyeOff, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EidosLogo } from '@/components/ui/eidos-logo'
import { formatPhoneBRInput, isValidWhatsAppPhone } from '@/lib/phone'

const BENEFICIOS = [
  'Pixel do Meta e CAPI nos seus formulários',
  'Aviso do lead no WhatsApp do seu cliente',
  '5.000 respostas por mês e formulários ilimitados',
]

export function TrialSignupForm({ codigo, dias }: { codigo: string; dias: number }) {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [erros, setErros] = useState<Record<string, string>>({})

  function validar() {
    const e: Record<string, string> = {}
    if (!fullName.trim()) e.fullName = 'Informe seu nome.'
    if (!phone.trim()) e.phone = 'Informe seu WhatsApp.'
    else if (!isValidWhatsAppPhone(phone)) e.phone = 'Telefone inválido. Inclua o DDD.'
    if (!email.trim()) e.email = 'Informe seu e-mail.'
    if (password.length < 8) e.password = 'A senha precisa de pelo menos 8 caracteres.'
    setErros(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    if (isLoading || !validar()) return
    setIsLoading(true)
    try {
      const resp = await fetch('/api/trial/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo, fullName, phone, email, password }),
      })
      const json = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        toast.error(json?.error ?? 'Não foi possível criar a conta.')
        return
      }
      setEnviado(true)
    } catch {
      toast.error('Falha de conexão. Tente novamente.')
    } finally {
      setIsLoading(false)
    }
  }

  if (enviado) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md text-center"
        >
          <EidosLogo variant="full" theme="dark" href="/" height={64} />
          <div className="mt-8 bg-[#111111] rounded-2xl p-8 border border-white/5">
            <div className="w-12 h-12 rounded-full bg-[#4BB678]/15 flex items-center justify-center mx-auto">
              <Check className="w-6 h-6 text-[#4BB678]" />
            </div>
            <h1 className="mt-5 text-xl font-semibold text-white">Confirme seu e-mail</h1>
            <p className="mt-3 text-slate-400 leading-relaxed">
              Enviamos um link para <span className="text-slate-200">{email}</span>. Ao clicar nele,
              seu acesso de {dias} dias é liberado na hora.
            </p>
            <p className="mt-4 text-xs text-slate-500">
              Não chegou em alguns minutos? Confira a caixa de spam.
            </p>
          </div>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center py-10">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md px-6 sm:px-8 relative z-10"
      >
        <div className="flex flex-col items-center mb-7">
          <EidosLogo variant="full" theme="dark" href="/" height={64} />
          <h1 className="mt-5 text-2xl font-semibold text-white text-center">
            Seu acesso de {dias} dias
          </h1>
          <p className="mt-2 text-slate-400 text-center text-sm">
            Plano Plus liberado, sem cartão.
          </p>
        </div>

        <ul className="mb-6 space-y-2">
          {BENEFICIOS.map((b) => (
            <li key={b} className="flex items-start gap-2.5 text-sm text-slate-300">
              <Check className="w-4 h-4 text-[#F5B731] mt-0.5 shrink-0" />
              <span>{b}</span>
            </li>
          ))}
        </ul>

        <div className="bg-[#111111] rounded-2xl shadow-xl shadow-black/20 p-6 sm:p-8 border border-white/5">
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="fullName" className="text-slate-300">Nome completo</Label>
              <Input
                id="fullName" type="text" placeholder="Seu nome" autoComplete="name"
                value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={isLoading}
                className="h-12 text-base bg-[#1a1a1a] text-white placeholder:text-slate-400"
              />
              {erros.fullName && <p className="text-xs text-red-400">{erros.fullName}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone" className="text-slate-300">WhatsApp</Label>
              <Input
                id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="(11) 99999-9999"
                value={phone} onChange={(e) => setPhone(formatPhoneBRInput(e.target.value))} disabled={isLoading}
                className="h-12 text-base bg-[#1a1a1a] text-white placeholder:text-slate-400"
              />
              {erros.phone
                ? <p className="text-xs text-red-400">{erros.phone}</p>
                : <p className="text-xs text-slate-500">Use o mesmo número em que você recebeu o convite.</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="text-slate-300">E-mail</Label>
              <Input
                id="email" type="email" placeholder="voce@exemplo.com" autoComplete="email"
                value={email} onChange={(e) => setEmail(e.target.value)} disabled={isLoading}
                className="h-12 text-base bg-[#1a1a1a] text-white placeholder:text-slate-400"
              />
              {erros.email && <p className="text-xs text-red-400">{erros.email}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-slate-300">Senha</Label>
              <div className="relative">
                <Input
                  id="password" type={showPassword ? 'text' : 'password'} placeholder="Mínimo 8 caracteres"
                  autoComplete="new-password" value={password}
                  onChange={(e) => setPassword(e.target.value)} disabled={isLoading}
                  className="h-12 text-base bg-[#1a1a1a] text-white placeholder:text-slate-400 pr-12"
                />
                <button
                  type="button" onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {erros.password && <p className="text-xs text-red-400">{erros.password}</p>}
            </div>

            <Button
              type="submit" disabled={isLoading}
              className="w-full h-12 text-base font-semibold bg-[#F5B731] hover:bg-[#E8923A] text-[#0a0a0a]"
            >
              {isLoading ? 'Criando sua conta…' : `Ativar meus ${dias} dias`}
            </Button>

            <p className="text-xs text-slate-500 text-center leading-relaxed">
              Sem cartão. Ao final dos {dias} dias sua conta continua ativa no plano gratuito,
              e você decide se quer assinar.
            </p>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-slate-500">
          Já tem conta?{' '}
          <button onClick={() => router.push('/login')} className="text-[#F5B731] hover:underline">
            Entrar
          </button>
        </p>
      </motion.div>
    </div>
  )
}
