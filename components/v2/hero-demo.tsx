'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, Check, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Demo conversacional do hero da /v2: simula a experiência do player
// (uma pergunta por vez) sem criar formulário nem gravar resposta.

const GOALS = ['Capturar mais leads', 'Aumentar conversão', 'Fazer pesquisas']

export function HeroDemo() {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [email, setEmail] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [step])

  const totalSteps = 3
  const progress = Math.min((step / totalSteps) * 100, 100)
  const firstName = name.trim().split(/\s+/)[0] || ''

  const canAdvance =
    (step === 0 && name.trim().length > 1) ||
    (step === 2 && /^\S+@\S+\.\S+$/.test(email.trim()))

  const advance = () => {
    if (canAdvance) setStep((s) => s + 1)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') advance()
  }

  const reset = () => {
    setStep(0)
    setName('')
    setGoal('')
    setEmail('')
  }

  return (
    <div className="relative">
      <div className="absolute -top-3 left-4 z-10">
        <span className="text-[11px] font-semibold uppercase tracking-wider bg-[#F5B731] text-black px-2.5 py-1 rounded-full shadow-lg shadow-[#F5B731]/30">
          Demonstração · experimente
        </span>
      </div>

      <div className="rounded-2xl border border-white/10 bg-slate-900/90 shadow-2xl shadow-black/40 overflow-hidden">
        {/* Barra de progresso, como no player real */}
        <div className="h-1 bg-white/5">
          <motion.div
            className="h-full bg-gradient-to-r from-[#F5B731] to-[#E8923A]"
            initial={false}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>

        <div className="p-6 sm:p-8 min-h-[340px] flex flex-col justify-center">
          <AnimatePresence mode="wait">
            {step === 0 && (
              <motion.div
                key="q1"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -24 }}
                transition={{ duration: 0.3 }}
              >
                <p className="text-sm text-[#F5B731] font-semibold mb-2">1 de 3</p>
                <h3 className="text-xl sm:text-2xl font-bold text-white mb-5">
                  Qual é o seu nome?
                </h3>
                <input
                  ref={inputRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Digite sua resposta aqui..."
                  className="w-full bg-transparent border-b-2 border-white/15 focus:border-[#F5B731] outline-none text-lg text-white placeholder:text-slate-600 py-2 transition-colors"
                />
                <div className="mt-5 flex items-center gap-3">
                  <Button
                    onClick={advance}
                    disabled={!canAdvance}
                    className="bg-[#F5B731] hover:bg-[#E8923A] text-black font-bold disabled:opacity-40"
                  >
                    OK <Check className="w-4 h-4 ml-1.5" />
                  </Button>
                  <span className="text-xs text-slate-500 hidden sm:block">
                    ou pressione <strong className="text-slate-400">Enter ↵</strong>
                  </span>
                </div>
              </motion.div>
            )}

            {step === 1 && (
              <motion.div
                key="q2"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -24 }}
                transition={{ duration: 0.3 }}
              >
                <p className="text-sm text-[#F5B731] font-semibold mb-2">2 de 3</p>
                <h3 className="text-xl sm:text-2xl font-bold text-white mb-5">
                  {firstName ? `Prazer, ${firstName}! ` : ''}O que você quer melhorar primeiro?
                </h3>
                <div className="space-y-2.5">
                  {GOALS.map((g, i) => (
                    <button
                      key={g}
                      onClick={() => {
                        setGoal(g)
                        setStep(2)
                      }}
                      className={`w-full flex items-center gap-3 text-left px-4 py-3 rounded-xl border text-sm sm:text-base transition-all ${
                        goal === g
                          ? 'border-[#F5B731] bg-[#F5B731]/10 text-white'
                          : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-[#F5B731]/50 hover:bg-white/[0.06]'
                      }`}
                    >
                      <span className="w-6 h-6 rounded-md border border-white/20 bg-white/5 text-xs font-bold flex items-center justify-center text-slate-400">
                        {String.fromCharCode(65 + i)}
                      </span>
                      {g}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="q3"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -24 }}
                transition={{ duration: 0.3 }}
              >
                <p className="text-sm text-[#F5B731] font-semibold mb-2">3 de 3</p>
                <h3 className="text-xl sm:text-2xl font-bold text-white mb-5">
                  E qual e-mail usamos para te responder?
                </h3>
                <input
                  ref={inputRef}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="voce@empresa.com.br"
                  className="w-full bg-transparent border-b-2 border-white/15 focus:border-[#F5B731] outline-none text-lg text-white placeholder:text-slate-600 py-2 transition-colors"
                />
                <div className="mt-5 flex items-center gap-3">
                  <Button
                    onClick={advance}
                    disabled={!canAdvance}
                    className="bg-[#F5B731] hover:bg-[#E8923A] text-black font-bold disabled:opacity-40"
                  >
                    Enviar <Check className="w-4 h-4 ml-1.5" />
                  </Button>
                  <span className="text-xs text-slate-500 hidden sm:block">
                    ou pressione <strong className="text-slate-400">Enter ↵</strong>
                  </span>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.35 }}
                className="text-center"
              >
                <div className="text-5xl mb-4">🎉</div>
                <h3 className="text-xl sm:text-2xl font-bold text-white mb-2">
                  {firstName ? `${firstName}, viu` : 'Viu'} como é diferente?
                </h3>
                <p className="text-slate-400 mb-6 text-sm sm:text-base">
                  Essa é a experiência que os seus leads vão ter.
                  {goal ? ` Perfeito para ${goal.toLowerCase()}.` : ''}
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <Link href="/register">
                    <Button className="bg-[#F5B731] hover:bg-[#E8923A] text-black font-bold px-6">
                      Criar o meu grátis
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </Link>
                  <button
                    onClick={reset}
                    className="text-sm text-slate-500 hover:text-white transition-colors flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Refazer demo
                  </button>
                </div>
                <p className="mt-4 text-xs text-slate-600">
                  Nenhum dado é enviado — isto é só uma demonstração.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
