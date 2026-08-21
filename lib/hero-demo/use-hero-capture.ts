'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { captureUtms, getUtms } from '@/lib/utm-tracker'
import { HERO_FORM_ID, HERO_Q, recomendarPlano } from './config'

/**
 * lib/hero-demo/use-hero-capture.ts — o cérebro da captura do hero, compartilhado por /v3 e /v4.
 *
 * POR QUE UM CONTROLLER, E NÃO O FormPlayer INTEIRO (parecer independente, 20/08/2026):
 * importar o player traria 20 tipos de pergunta, lógica condicional, integrações e estado que a
 * landing não usa — peso e risco de regressão no hero, que é a primeira dobra da página de venda.
 * Aqui vive só o protocolo; os wrappers visuais (escuro na v3, claro na v4) ficam nos componentes.
 *
 * O QUE ELE REUSA DO PLAYER (e por que importa): o endpoint público de parciais já resolve as
 * partes difíceis — session key, prova de posse (partial_token), revisão crescente contra save
 * fora de ordem, e convergência entre fetch/beacon/submit pelo índice único do banco. Reescrever
 * isso no hero seria reintroduzir bugs que já custaram caro (duplicatas de 08/07).
 *
 * GARANTIAS DESTE CONTROLLER:
 *  · a cada avanço, salva parcial → quem abandona no meio JÁ deixou nome/WhatsApp/e-mail;
 *  · sucesso só depois de 2xx do servidor — nunca mostra "obrigado" por otimismo;
 *  · duplo clique não envia duas vezes;
 *  · a aba fechando dispara beacon com o que houver;
 *  · nada toca `window` durante o render inicial (a página é Server Component; o hero é ilha).
 */

export type PassoHero = 0 | 1 | 2 | 3 | 4 | 5
export type EstadoEnvio = 'ocioso' | 'enviando' | 'erro'

const CHAVE_SESSAO = 'eidos_hero_session'
const CHAVE_REVISAO = 'eidos_hero_revision'

export type HeroCapture = ReturnType<typeof useHeroCapture>

export function useHeroCapture() {
  const [passo, setPasso] = useState<PassoHero>(0)
  const [nome, setNome] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [email, setEmail] = useState('')
  const [objetivo, setObjetivo] = useState('')
  const [volume, setVolume] = useState('')
  const [envio, setEnvio] = useState<EstadoEnvio>('ocioso')
  const [erro, setErro] = useState<string | null>(null)

  const responseIdRef = useRef<string | null>(null)
  const tokenRef = useRef<string | null>(null)
  const sessaoRef = useRef<string | null>(null)
  const revisaoRef = useRef(0)
  const enviadoRef = useRef(false)
  const enviandoRef = useRef(false)

  // UTM capturada na montagem (não no render): a landing recebe tráfego pago e essa origem
  // precisa viajar junto do lead — é a mesma feature que a página vende três seções abaixo.
  useEffect(() => { try { captureUtms() } catch { /* best-effort */ } }, [])

  const sessionKey = useCallback((): string => {
    if (sessaoRef.current) return sessaoRef.current
    let key: string
    try { key = crypto.randomUUID() } catch {
      const b = new Uint8Array(16); crypto.getRandomValues(b)
      key = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
    }
    sessaoRef.current = key
    try { window.sessionStorage.setItem(CHAVE_SESSAO, key) } catch { /* ignore */ }
    return key
  }, [])

  const proximaRevisao = useCallback((): number => {
    revisaoRef.current += 1
    try { window.sessionStorage.setItem(CHAVE_REVISAO, String(revisaoRef.current)) } catch { /* ignore */ }
    return revisaoRef.current
  }, [])

  /** O que já foi respondido, no formato do formulário (id da pergunta → valor). */
  const respostas = useCallback((): Record<string, unknown> => {
    const r: Record<string, unknown> = {}
    if (nome.trim()) r[HERO_Q.nome] = nome.trim()
    if (whatsapp.trim()) r[HERO_Q.whatsapp] = whatsapp.trim()
    if (email.trim()) r[HERO_Q.email] = email.trim()
    if (objetivo) r[HERO_Q.objetivo] = objetivo
    if (volume) r[HERO_Q.volume] = volume
    return r
  }, [nome, whatsapp, email, objetivo, volume])

  /**
   * Salva o progresso. Chamado a CADA avanço — é o que transforma abandono em lead recuperável.
   * Best-effort de ponta a ponta: falhar aqui nunca pode travar a demo na cara do visitante.
   */
  const salvarParcial = useCallback(async (ultimaPergunta: string) => {
    if (enviadoRef.current) return
    const answers = respostas()
    if (Object.keys(answers).length === 0) return
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (responseIdRef.current) headers['x-response-id'] = responseIdRef.current
      if (tokenRef.current) headers['x-partial-token'] = tokenRef.current
      headers['x-partial-session'] = sessionKey()
      const res = await fetch('/api/responses/partial', {
        method: 'POST', headers, keepalive: true,
        body: JSON.stringify({
          form_id: HERO_FORM_ID,
          answers,
          last_question_answered: ultimaPergunta,
          partial_revision: proximaRevisao(),
          protocol_version: 2,
          capi_hints: [],
          ...getUtms(),
        }),
      })
      if (!res.ok) return
      const json = await res.json().catch(() => null) as { response_id?: string; partial_token?: string } | null
      if (json?.response_id) responseIdRef.current = json.response_id
      if (json?.partial_token) tokenRef.current = json.partial_token
    } catch { /* best-effort */ }
  }, [respostas, sessionKey, proximaRevisao])

  /** Beacon no fechamento da aba: o último estado ainda vira lead. */
  useEffect(() => {
    const despedida = () => {
      if (enviadoRef.current) return
      const answers = respostas()
      if (Object.keys(answers).length === 0) return
      try {
        const payload = {
          form_id: HERO_FORM_ID,
          answers,
          partial_revision: proximaRevisao(),
          protocol_version: 2,
          capi_hints: [],
          ...getUtms(),
          response_id: responseIdRef.current ?? undefined,
          partial_token: tokenRef.current ?? undefined,
          partial_session: sessaoRef.current ?? undefined,
        }
        navigator.sendBeacon('/api/responses/partial',
          new Blob([JSON.stringify(payload)], { type: 'application/json' }))
      } catch { /* ignore */ }
    }
    const aoEsconder = () => { if (document.visibilityState === 'hidden') despedida() }
    document.addEventListener('visibilitychange', aoEsconder)
    window.addEventListener('pagehide', despedida)
    return () => {
      document.removeEventListener('visibilitychange', aoEsconder)
      window.removeEventListener('pagehide', despedida)
    }
  }, [respostas, proximaRevisao])

  const avancar = useCallback((perguntaId: string) => {
    void salvarParcial(perguntaId)
    setPasso((p) => (p + 1) as PassoHero)
  }, [salvarParcial])

  /**
   * Envio final. Só marca sucesso depois do 2xx E de `completed !== false` — o servidor pode
   * responder 200 com resposta INCOMPLETA (lição de 16/08: o player mostrava "enviado", o lead
   * ia embora achando que terminou, e o dono registrava conversão que não existiu).
   */
  const enviar = useCallback(async () => {
    if (enviandoRef.current || enviadoRef.current) return
    enviandoRef.current = true
    setEnvio('enviando')
    setErro(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (responseIdRef.current) headers['x-response-id'] = responseIdRef.current
      if (tokenRef.current) headers['x-partial-token'] = tokenRef.current
      headers['x-partial-session'] = sessionKey()
      const res = await fetch('/api/responses', {
        method: 'POST', headers,
        body: JSON.stringify({
          form_id: HERO_FORM_ID,
          answers: respostas(),
          completed: true,
          last_question_answered: HERO_Q.volume,
          protocol_version: 2,
          capi_hints: [],
          ...getUtms(),
        }),
      })
      if (!res.ok) {
        setErro(res.status === 429
          ? 'Muitos envios agora. Tente de novo em instantes.'
          : 'Não foi possível enviar. Tente de novo.')
        setEnvio('erro')
        enviandoRef.current = false
        return
      }
      const json = await res.json().catch(() => null) as { completed?: boolean } | null
      if (json && json.completed === false) {
        setErro('O envio não foi concluído. Confira as respostas.')
        setEnvio('erro')
        enviandoRef.current = false
        return
      }
      enviadoRef.current = true
      setEnvio('ocioso')
      setPasso(5)
    } catch {
      setErro('Sem conexão. Tente de novo.')
      setEnvio('erro')
      enviandoRef.current = false
    }
  }, [respostas, sessionKey])

  const reiniciar = useCallback(() => {
    enviadoRef.current = false
    enviandoRef.current = false
    responseIdRef.current = null
    tokenRef.current = null
    sessaoRef.current = null
    setNome(''); setWhatsapp(''); setEmail(''); setObjetivo(''); setVolume('')
    setErro(null); setEnvio('ocioso'); setPasso(0)
  }, [])

  const primeiroNome = nome.trim().split(/\s+/)[0] || ''
  const soDigitos = whatsapp.replace(/\D/g, '')

  return {
    passo, setPasso,
    nome, setNome, whatsapp, setWhatsapp, email, setEmail,
    objetivo, setObjetivo, volume, setVolume,
    envio, erro, primeiroNome,
    // Validação por passo: WhatsApp brasileiro tem 10 ou 11 dígitos + DDI opcional.
    podeAvancar:
      (passo === 0 && nome.trim().length > 1) ||
      (passo === 1 && soDigitos.length >= 10 && soDigitos.length <= 13) ||
      (passo === 2 && /^\S+@\S+\.\S+$/.test(email.trim())) ||
      (passo === 3 && Boolean(objetivo)) ||
      (passo === 4 && Boolean(volume)),
    avancar, enviar, reiniciar,
    recomendacao: recomendarPlano(volume),
  }
}
