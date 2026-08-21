'use client'

import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { ArrowRight, Check, RotateCcw, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useHeroCapture } from '@/lib/hero-demo/use-hero-capture'
import { HERO_OBJETIVOS, HERO_VOLUMES, HERO_Q } from '@/lib/hero-demo/config'

/**
 * Hero da /v3 — a demonstração que TAMBÉM captura (D-10, 20/08/2026).
 *
 * ANTES: teatro puro — três `useState`, nada saía do navegador, e uma linha no fim prometia
 * "Nenhum dado é enviado". Quem testava se perdia.
 *
 * AGORA: é um formulário EidosForm de verdade, na conta técnica dedicada. A landing passa a
 * rodar SOBRE o produto que vende — UTM gravada, resposta parcial de quem desiste, e o lead
 * chega inteiro. O enquadramento de demonstração PERMANECE (o selo continua): a experiência é
 * a mesma que o visitante teria como cliente. O que mudou é que ela é real.
 *
 * O protocolo mora em `use-hero-capture` (compartilhado com a /v4). Aqui só o visual escuro.
 */
export function HeroDemo() {
  const h = useHeroCapture()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [h.passo])

  const total = 5
  const progresso = Math.min((h.passo / total) * 100, 100)

  const aoTeclar = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && h.podeAvancar) {
      e.preventDefault()
      const perguntas = [HERO_Q.nome, HERO_Q.whatsapp, HERO_Q.email]
      if (h.passo <= 2) h.avancar(perguntas[h.passo])
    }
  }

  const campo = (
    valor: string, mudar: (v: string) => void, tipo: string, dica: string,
  ) => (
    <input
      ref={inputRef}
      type={tipo}
      value={valor}
      onChange={(e) => mudar(e.target.value)}
      onKeyDown={aoTeclar}
      placeholder={dica}
      className="w-full bg-transparent border-b-2 border-white/15 focus:border-[#F5B731] outline-none text-lg text-white placeholder:text-slate-600 py-2 transition-colors"
    />
  )

  const botaoOk = (perguntaId: string) => (
    <div className="mt-5 flex items-center gap-3">
      <Button
        onClick={() => h.avancar(perguntaId)}
        disabled={!h.podeAvancar}
        className="bg-[#F5B731] hover:bg-[#E8923A] text-black font-bold disabled:opacity-40"
      >
        OK <Check className="w-4 h-4 ml-1.5" />
      </Button>
      <span className="text-xs text-slate-500 hidden sm:block">
        ou pressione <strong className="text-slate-400">Enter ↵</strong>
      </span>
    </div>
  )

  const escolhas = (
    opcoes: readonly string[], valor: string, escolher: (v: string) => void,
  ) => (
    <div className="space-y-2.5">
      {opcoes.map((op) => (
        <button
          key={op}
          onClick={() => escolher(op)}
          className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
            valor === op
              ? 'border-[#F5B731] bg-[#F5B731]/10 text-white'
              : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'
          }`}
        >
          {op}
        </button>
      ))}
    </div>
  )

  const passoWrap = (chave: string, indice: number, titulo: string, conteudo: React.ReactNode) => (
    <motion.div
      key={chave}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -24 }}
      transition={{ duration: 0.3 }}
    >
      <p className="text-sm text-[#F5B731] font-semibold mb-2">{indice} de {total}</p>
      <h3 className="text-xl sm:text-2xl font-bold text-white mb-5">{titulo}</h3>
      {conteudo}
    </motion.div>
  )

  return (
    <div className="relative">
      <div className="absolute -top-3 left-4 z-10">
        <span className="text-[11px] font-semibold uppercase tracking-wider bg-[#F5B731] text-black px-2.5 py-1 rounded-full shadow-lg shadow-[#F5B731]/30">
          Demonstração · experimente
        </span>
      </div>

      <div className="rounded-2xl border border-white/10 bg-slate-900/90 shadow-2xl shadow-black/40 overflow-hidden">
        <div className="h-1 bg-white/5">
          <motion.div
            className="h-full bg-gradient-to-r from-[#F5B731] to-[#E8923A]"
            initial={false}
            animate={{ width: `${progresso}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>

        {/* min-h fixo: a altura não pode variar entre passos, senão a primeira dobra da página
            de venda "pula" a cada avanço. */}
        <div className="p-6 sm:p-8 min-h-[340px] flex flex-col justify-center">
          <AnimatePresence mode="wait">
            {h.passo === 0 && passoWrap('q1', 1, 'Qual é o seu nome?', (
              <>
                {campo(h.nome, h.setNome, 'text', 'Digite sua resposta aqui...')}
                {botaoOk(HERO_Q.nome)}
              </>
            ))}

            {h.passo === 1 && passoWrap('q2', 2,
              h.primeiroNome ? `Prazer, ${h.primeiroNome}! Qual o seu WhatsApp?` : 'Qual o seu WhatsApp?', (
              <>
                {campo(h.whatsapp, h.setWhatsapp, 'tel', '(00) 00000-0000')}
                {botaoOk(HERO_Q.whatsapp)}
              </>
            ))}

            {h.passo === 2 && passoWrap('q3', 3, 'E o seu melhor e-mail?', (
              <>
                {campo(h.email, h.setEmail, 'email', 'voce@empresa.com')}
                {botaoOk(HERO_Q.email)}
              </>
            ))}

            {h.passo === 3 && passoWrap('q4', 4, 'O que você quer melhorar primeiro?', (
              <>
                {escolhas(HERO_OBJETIVOS, h.objetivo, (v) => { h.setObjetivo(v); setTimeout(() => h.avancar(HERO_Q.objetivo), 180) })}
              </>
            ))}

            {h.passo === 4 && passoWrap('q5', 5, 'Quantas respostas por mês você espera?', (
              <>
                {/* A escolha NÃO submete sozinha: o envio é um clique deliberado, com o aviso
                    à vista. É o que transforma "recebi mensagem do nada" em "eu pedi". */}
                {escolhas(HERO_VOLUMES, h.volume, h.setVolume)}
                <div className="mt-5">
                  <Button
                    onClick={h.enviar}
                    disabled={!h.podeAvancar || h.envio === 'enviando'}
                    className="bg-[#F5B731] hover:bg-[#E8923A] text-black font-bold disabled:opacity-40 w-full sm:w-auto"
                  >
                    {h.envio === 'enviando'
                      ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Enviando...</>)
                      : (<>Enviar teste <Check className="w-4 h-4 ml-1.5" /></>)}
                  </Button>
                  <p className="mt-3 text-xs text-slate-500 leading-relaxed">
                    Seus dados são salvos, como aconteceria num formulário seu.
                    A equipe do EidosForm pode te chamar no WhatsApp para ajudar.
                  </p>
                  {h.erro && (
                    <p role="alert" className="mt-3 flex items-start gap-2 text-xs text-red-300">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-px" /> {h.erro}
                    </p>
                  )}
                </div>
              </>
            ))}

            {h.passo === 5 && (
              <motion.div
                key="fim"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.35 }}
                className="text-center"
              >
                <div className="text-5xl mb-4">🎉</div>
                <h3 className="text-xl sm:text-2xl font-bold text-white mb-2">
                  {h.primeiroNome ? `${h.primeiroNome}, viu` : 'Viu'} como é diferente?
                </h3>
                <p className="text-slate-400 mb-2 text-sm sm:text-base">
                  Essa é a experiência que os seus leads vão ter.
                </p>
                {/* A recomendação de plano mora AQUI e na conversa da Elen — nunca no template
                    de WhatsApp, onde recomendar produto viraria MARKETING. */}
                <p className="text-slate-300 mb-6 text-sm sm:text-base">
                  Para {h.objetivo.toLowerCase()} com esse volume, {h.recomendacao.frase}.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <Link href="/register">
                    <Button className="bg-[#F5B731] hover:bg-[#E8923A] text-black font-bold px-6">
                      Criar o meu grátis
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </Link>
                  <a
                    href={`https://wa.me/5583999378937?text=${encodeURIComponent('Oi! Acabei de testar a demonstração do EidosForm.')}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-sm text-slate-400 hover:text-white transition-colors"
                  >
                    Falar com a Elen
                  </a>
                  <button
                    onClick={h.reiniciar}
                    className="text-sm text-slate-500 hover:text-white transition-colors flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Refazer
                  </button>
                </div>
                <p className="mt-4 text-xs text-slate-600">
                  Seus dados foram salvos — como num formulário seu de verdade.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
