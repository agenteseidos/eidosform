'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import Image from 'next/image'
import { Form, QuestionConfig, Json } from '@/lib/database.types'
import { PixelEventRule } from '@/types/pixel-events'
import { getTheme, getThemeCSSVariables } from '@/lib/themes'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { ChevronUp, ChevronDown, Check, ArrowRight, Lock } from 'lucide-react'
import { QuestionRenderer } from './question-renderer'
import { toast } from 'sonner'
import { evaluatePixelEvents, fireNamedPixelEvent } from '@/lib/pixel-events'
import { evaluateJumpRules, getVisibleQuestions } from '@/lib/form-logic-engine'
import { captureUtms, getUtms } from '@/lib/utm-tracker'
import { useMetaEventsCapture } from '@/hooks/use-meta-events-capture'
import { createClient } from '@/lib/supabase/client'

interface FormPlayerProps {
  ownerPlan?: string
  form: Form
}

interface PendingAnswerOverride {
  questionId: string
  value: Json
}

function ensureHttps(url: string): string {
  if (!url) return url
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return 'https://' + url
}

export const FormPlayer = React.memo(function FormPlayer({ form, ownerPlan = 'free' }: FormPlayerProps) {
  const questions = (form.questions as QuestionConfig[]) || []
  const theme = getTheme(form.theme)
  const themeStyles = getThemeCSSVariables(theme)

  const [currentIndex, setCurrentIndex] = useState(form.welcome_enabled ? -1 : 0)
  const [answers, setAnswers] = useState<Record<string, Json>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [direction, setDirection] = useState(0)
  const [progressAnim, setProgressAnim] = useState(0)
  const [responseId, setResponseId] = useState<string | null>(null)
  const [navigationHistory, setNavigationHistory] = useState<number[]>([])
  const metaEvents = useMetaEventsCapture(Boolean(form.pixels) && (ownerPlan === 'plus' || ownerPlan === 'professional'))
  const partialResponsesEnabled = (ownerPlan === 'plus' || ownerPlan === 'professional')

  // Check authentication on mount
  useEffect(() => {
    let cancelled = false
    async function checkAuth() {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (cancelled) return
        isAuthenticatedRef.current = !!session

        if (session && partialResponsesEnabled) {
          loadPartialProgress()
        }
      } catch {
        // Not authenticated — keep in-memory only
      }
    }
    checkAuth()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load saved partial response
  async function loadPartialProgress() {
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return

      const res = await fetch(`/api/forms/${form.id}/partial-response`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) return

      const data = await res.json()
      if (data.answers && typeof data.answers === 'object' && Object.keys(data.answers).length > 0) {
        setAnswers(data.answers)
        if (data.response_id) setResponseId(data.response_id)
        // Restore position
        if (data.last_question_answered) {
          const idx = visibleQuestions.findIndex(q => q.id === data.last_question_answered)
          if (idx !== -1) setCurrentIndex(idx)
        }
      }
    } catch {
      // Silent fail
    }
  }

  const containerRef = useRef<HTMLDivElement>(null)
  const triggerPixelSubmitRef = useRef<(() => void) | null>(null)
  const skipNextValidationRef = useRef(false)
  const partialSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isSubmittedRef = useRef(false)
  const isAuthenticatedRef = useRef(false)

  // Lista de perguntas visíveis com base nas respostas atuais
  const visibleQuestions = getVisibleQuestions(questions, answers) as QuestionConfig[]

  const currentQuestion = visibleQuestions[currentIndex]
  const isContentStep = currentQuestion?.type === 'content_block'
  const isLastQuestion = currentIndex === visibleQuestions.length - 1
  const isFirstQuestion = form.welcome_enabled ? currentIndex === -1 : currentIndex === 0
  // Progresso baseado em total original de perguntas (não visíveis) para evitar saltos com conditional logic
  const answeredCount = questions.filter(q => q.type !== 'content_block' && answers[q.id] !== undefined && answers[q.id] !== '' && !(Array.isArray(answers[q.id]) && (answers[q.id] as unknown[]).length === 0)).length
  const questionCount = questions.filter(q => q.type !== 'content_block').length
  const positionProgress = questionCount > 0 ? ((answeredCount + 1) / questionCount) * 100 : 0
  const answeredProgress = questionCount > 0 ? (answeredCount / questionCount) * 100 : 0
  const progressFull = Math.max(positionProgress, answeredProgress)

  // Animate progress on question change
  useEffect(() => {
    const timer = setTimeout(() => setProgressAnim(progressFull), 120)
    return () => clearTimeout(timer)
  }, [progressFull])

  const validateCurrentQuestion = useCallback((candidateAnswers?: Record<string, Json>) => {
    if (!currentQuestion) return true
    if (currentQuestion.type === 'content_block') return true

    const answerSource = candidateAnswers ?? answers
    const answer = answerSource[currentQuestion.id]

    if (currentQuestion.required) {
      if (answer === undefined || answer === null || answer === '') {
        setErrors(prev => ({ ...prev, [currentQuestion.id]: 'Este campo é obrigatório' }))
        return false
      }
      if (Array.isArray(answer) && answer.length === 0) {
        setErrors(prev => ({ ...prev, [currentQuestion.id]: 'Selecione ao menos uma opção' }))
        return false
      }
    }

    if (answer && currentQuestion.type === 'email') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(answer))) {
        setErrors(prev => ({ ...prev, [currentQuestion.id]: 'Por favor, insira um e-mail válido' }))
        return false
      }
    }

    if (answer && currentQuestion.type === 'url') {
      try { new URL(String(answer)) } catch {
        setErrors(prev => ({ ...prev, [currentQuestion.id]: 'Por favor, insira uma URL válida' }))
        return false
      }
    }

    if (answer && currentQuestion.type === 'phone') {
      if (!/^[+]?[\d\s\-().]+$/.test(String(answer))) {
        setErrors(prev => ({ ...prev, [currentQuestion.id]: 'Por favor, insira um telefone válido' }))
        return false
      }
    }

    setErrors(prev => { const e = { ...prev }; delete e[currentQuestion.id]; return e })
    return true
  }, [currentQuestion, answers])

  const goToNext = useCallback((skipValidation?: boolean, pendingAnswer?: PendingAnswerOverride) => {
    const shouldSkip = skipValidation || skipNextValidationRef.current
    skipNextValidationRef.current = false

    const updatedAnswers = pendingAnswer
      ? { ...answers, [pendingAnswer.questionId]: pendingAnswer.value }
      : { ...answers }

    if (!shouldSkip && !validateCurrentQuestion(updatedAnswers)) return

    // Salvar progresso parcial antes de avançar
    if (currentQuestion) {
      savePartialResponseDebounced(updatedAnswers, currentQuestion.id)
      // Avaliar pixel events condicionais da pergunta atual com a resposta recém-selecionada
      if (currentQuestion.pixelEvents) {
        evaluatePixelEvents(currentQuestion.pixelEvents as PixelEventRule[], updatedAnswers[currentQuestion.id])
      }

      // Avaliar jump rules com answers atualizadas
      if (currentQuestion.jumpRules && currentQuestion.jumpRules.length > 0) {
        const jumpAction = evaluateJumpRules(currentQuestion.jumpRules, updatedAnswers)
        if (jumpAction) {
          if (jumpAction.type === 'submit') {
            handleSubmit(updatedAnswers)
            return
          }
          if (jumpAction.type === 'jump' && jumpAction.targetQuestionId) {
            const targetIdx = visibleQuestions.findIndex(q => q.id === jumpAction.targetQuestionId)
            if (targetIdx !== -1) {
              setNavigationHistory(prev => [...prev, currentIndex])
              setDirection(1)
              setCurrentIndex(targetIdx)
              return
            }
          }
        }
      }
    }

    if (isLastQuestion) {
      handleSubmit(updatedAnswers)
    } else {
      setNavigationHistory(prev => [...prev, currentIndex])
      setDirection(1)
      setCurrentIndex(prev => Math.min(prev + 1, visibleQuestions.length - 1))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLastQuestion, visibleQuestions, validateCurrentQuestion, answers, currentQuestion, currentIndex])

  const goToPrevious = useCallback(() => {
    setDirection(-1)
    if (navigationHistory.length > 0) {
      const prevIndex = navigationHistory[navigationHistory.length - 1]
      setNavigationHistory(prev => prev.slice(0, -1))
      setCurrentIndex(prevIndex)
    } else {
      const minIndex = form.welcome_enabled ? -1 : 0
      setCurrentIndex(prev => Math.max(prev - 1, minIndex))
    }
  }, [form, navigationHistory])

  // Salva resposta parcial com debounce (2s) — só se autenticado e plano permitir
  function savePartialResponseDebounced(currentAnswers: Record<string, Json>, lastQuestionId: string) {
    if (!isAuthenticatedRef.current || !partialResponsesEnabled) return
    if (isSubmittedRef.current) return

    if (partialSaveTimerRef.current) clearTimeout(partialSaveTimerRef.current)
    partialSaveTimerRef.current = setTimeout(async () => {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) return

        const res = await fetch(`/api/forms/${form.id}/partial-response`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            answers: currentAnswers,
            last_question_answered: lastQuestionId,
          }),
        })

        if (res.ok) {
          const data = await res.json()
          if (data.response_id) setResponseId(data.response_id)
          toast.success('Progresso salvo', { duration: 2000, description: 'Seu preenchimento foi salvo automaticamente.' })
        }
      } catch {
        toast.error('Falha ao salvar progresso', { duration: 3000, description: 'Verifique sua conexão.' })
      }
    }, 2000)
  }

  const handleSubmit = async (submissionAnswers?: Record<string, Json>) => {
    // Limpar timer de partial save para evitar race condition
    if (partialSaveTimerRef.current) {
      clearTimeout(partialSaveTimerRef.current)
      partialSaveTimerRef.current = null
    }
    isSubmittedRef.current = true

      // Honeypot check
      const honeypot = (document.querySelector('input[name="_hp_"]') as HTMLInputElement)?.value
      if (honeypot) {
        setIsSubmitting(false)
        return
      }

      const finalAnswers = submissionAnswers ?? answers

    if (!validateCurrentQuestion(finalAnswers)) return
    setIsSubmitting(true)

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (responseId) headers['x-response-id'] = responseId

      const utms = getUtms()

      // Get respondent_id if authenticated
      let respondentId: string | null = null
      if (isAuthenticatedRef.current) {
        try {
          const supabase = createClient()
          const { data: { session } } = await supabase.auth.getSession()
          respondentId = session?.user?.id ?? null
        } catch { /* ignore */ }
      }

      const res = await fetch('/api/responses', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          form_id: form.id,
          answers: finalAnswers,
          completed: true,
          last_question_answered: currentQuestion?.id ?? null,
          respondent_id: respondentId,
          ...utms,
          meta_events: metaEvents,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error ?? 'Falha ao enviar resposta')
        setIsSubmitting(false)
        return
      }

      triggerPixelSubmitRef.current?.()
      // Pixel event global de conclusão
      const completeEvent = form.pixel_event_on_complete
      if (completeEvent) fireNamedPixelEvent(completeEvent)
      setIsSubmitted(true)
      if (form.redirect_url) {
        const redirectDelay = form.redirect_delay != null ? Number(form.redirect_delay) : 2800
        setTimeout(() => { window.location.href = ensureHttps(form.redirect_url!) }, redirectDelay)
      }
    } catch (e) {
      toast.error('Falha ao enviar resposta')
      setIsSubmitting(false)
    }
  }

  const updateAnswer = useCallback((questionId: string, value: Json) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }))
    if (errors[questionId]) {
      setErrors(prev => { const e = { ...prev }; delete e[questionId]; return e })
    }
  }, [errors])

  useEffect(() => {
    captureUtms()
  }, [])

  // Pixel event: ao iniciar formulário (sem welcome screen)
  useEffect(() => {
    if (!form.welcome_enabled && form.pixel_event_on_start) {
      fireNamedPixelEvent(form.pixel_event_on_start)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleWelcomeStart = useCallback(() => {
    setDirection(1)
    setCurrentIndex(0)
    if (form.pixel_event_on_start) fireNamedPixelEvent(form.pixel_event_on_start)
  }, [form.pixel_event_on_start])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isSubmitted || isSubmitting) return

      if (e.key === 'Enter' && !e.shiftKey) {
        if (currentQuestion?.type === 'content_block') {
          e.preventDefault()
          return
        }
        if (currentQuestion?.type === 'long_text') {
          if (e.metaKey || e.ctrlKey) { e.preventDefault(); goToNext() }
          return
        }
        e.preventDefault()
        goToNext()
      }

      if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
        // Only intercept if not scrolling an overflow container
        const target = e.target as HTMLElement
        const scrollable = target.closest('[class*=overflow-y],[class*=overflow-auto],[style*=overflow]')
        if (!scrollable || scrollable.scrollTop <= 0) {
          e.preventDefault()
          goToPrevious()
        }
      }

      if (e.key === 'ArrowDown') {
        if (currentQuestion?.type === 'content_block') {
          e.preventDefault()
          return
        }
        // Only intercept if not scrolling an overflow container
        const target = e.target as HTMLElement
        const scrollable = target.closest('[class*=overflow-y],[class*=overflow-auto],[style*=overflow]')
        if (!scrollable || scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight - 1) {
          e.preventDefault()
          goToNext()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentQuestion, goToNext, goToPrevious, isSubmitted, isSubmitting])

  // Wheel navigation removido — navegação apenas via botões ou resposta

  // ─── Thank you screen ────────────────────────────────────────────────────────
  if (isSubmitted) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-6"
        style={{ ...themeStyles, backgroundColor: theme.backgroundColor, fontFamily: theme.fontFamily }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="text-center max-w-lg w-full px-4"
        >
          <motion.div
            initial={{ scale: 0, rotate: -90 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ delay: 0.25, type: 'spring', stiffness: 220, damping: 14 }}
            className="w-20 h-20 mx-auto mb-8 rounded-full flex items-center justify-center"
            style={{ backgroundColor: `${theme.primaryColor}1A` }}
          >
            <Check className="w-10 h-10" style={{ color: theme.primaryColor }} />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.38 }}
            className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4 leading-tight"
            style={{ color: theme.textColor }}
          >
            {form.thank_you_title || form.thank_you_message || 'Obrigado! 🎉'}
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.48 }}
            className="text-base md:text-lg opacity-70"
            style={{ color: theme.textColor }}
          >
            {form.thank_you_description || 'Sua resposta foi registrada com sucesso.'}
          </motion.p>

          {form.thank_you_button_text && form.thank_you_button_url && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.58 }}
              className="mt-6"
            >
              <a
                href={ensureHttps(form.thank_you_button_url!)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-6 py-3 rounded-full font-semibold text-sm transition-opacity hover:opacity-80"
                style={{ backgroundColor: theme.primaryColor, color: theme.backgroundColor }}
              >
                {form.thank_you_button_text}
              </a>
            </motion.div>
          )}

          {form.redirect_url && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.65 }}
              className="mt-4 text-sm opacity-40"
              style={{ color: theme.textColor }}
            >
              Redirecionando em instantes…
            </motion.p>
          )}

          {!form.hide_branding && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8 }}
              className="mt-12"
            >
              <a
                href="/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm opacity-60 hover:opacity-90 transition-opacity"
                style={{ color: theme.textColor }}
              >
                Feito com <span className="font-semibold">EidosForm</span>
              </a>
            </motion.div>
          )}
        </motion.div>
      </div>
    )
  }


  // ─── Closed form screen ─────────────────────────────────────────────────────
  if (form.is_closed) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-6"
        style={{ ...themeStyles, backgroundColor: theme.backgroundColor, fontFamily: theme.fontFamily }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="text-center max-w-lg w-full px-4"
        >
          <motion.div
            initial={{ scale: 0, rotate: -90 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 220, damping: 14 }}
            className="w-20 h-20 mx-auto mb-8 rounded-full flex items-center justify-center"
            style={{ backgroundColor: `${theme.primaryColor}1A` }}
          >
            <Lock className="w-9 h-9" style={{ color: theme.primaryColor }} />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.32 }}
            className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4 leading-tight"
            style={{ color: theme.textColor }}
          >
            Formulário encerrado
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.42 }}
            className="text-base md:text-lg opacity-70"
            style={{ color: theme.textColor }}
          >
            Este formulário não está mais aceitando novas respostas no momento.
          </motion.p>

          {!form.hide_branding && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7 }}
              className="mt-12"
            >
              <a
                href="/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm opacity-60 hover:opacity-90 transition-opacity"
                style={{ color: theme.textColor }}
              >
                Feito com <span className="font-semibold">EidosForm</span>
              </a>
            </motion.div>
          )}
        </motion.div>
      </div>
    )
  }

  // ─── Welcome screen ──────────────────────────────────────────────────────────
  if (currentIndex === -1 && form.welcome_enabled) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-6"
        style={{ ...themeStyles, backgroundColor: theme.backgroundColor, fontFamily: theme.fontFamily }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="text-center max-w-lg w-full px-4"
        >
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="text-2xl sm:text-3xl font-bold mb-4 leading-tight"
            style={{ color: theme.textColor }}
          >
            {form.welcome_image_url && (
              <Image src={form.welcome_image_url} width={200} height={80} className="max-h-20 max-w-full object-contain mx-auto mb-4" alt="Logo do formulário" />
            )}
            {form.welcome_title || form.title}
          </motion.h1>

          {form.welcome_description && (
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.28 }}
              className="text-base md:text-lg opacity-70 mb-8"
              style={{ color: theme.textColor }}
            >
              {form.welcome_description}
            </motion.p>
          )}

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <Button
              onClick={handleWelcomeStart}
              className="h-14 px-10 text-lg font-semibold rounded-xl transition-transform active:scale-95"
              style={{ backgroundColor: theme.primaryColor, color: theme.backgroundColor }}
            >
              {form.welcome_button_text || 'Começar'}
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </motion.div>

          {!form.hide_branding && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7 }}
              className="mt-12"
            >
              <a
                href="/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm opacity-60 hover:opacity-90 transition-opacity"
                style={{ color: theme.textColor }}
              >
                Feito com <span className="font-semibold">EidosForm</span>
              </a>
            </motion.div>
          )}
        </motion.div>
      </div>
    )
  }

  // ─── Empty form ──────────────────────────────────────────────────────────────
  if (visibleQuestions.length === 0) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-6"
        style={{ backgroundColor: theme.backgroundColor, fontFamily: theme.fontFamily }}
      >
        <p style={{ color: theme.textColor }} className="opacity-50">Este formulário ainda não tem perguntas.</p>
      </div>
    )
  }

  const slideVariants = {
    enter: (dir: number) => ({ y: dir > 0 ? 72 : -72, opacity: 0, scale: 0.98 }),
    center: { y: 0, opacity: 1, scale: 1 },
    exit: (dir: number) => ({ y: dir > 0 ? -72 : 72, opacity: 0, scale: 0.98 }),
  }

  return (
    <div
      ref={containerRef}
      className="min-h-screen flex flex-col"
      style={{ ...themeStyles, backgroundColor: theme.backgroundColor, fontFamily: theme.fontFamily }}
    >

      {/* ── Progress bar (hidden on welcome screen) ── */}
      {currentIndex >= 0 && (<>
      <div className="fixed top-0 left-0 right-0 z-50 h-[4px]" style={{ backgroundColor: `${theme.primaryColor}20` }} role="progressbar" aria-valuenow={Math.round(progressAnim)} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso do formulário">
        <motion.div
          className="h-full rounded-r-full"
          style={{ backgroundColor: theme.primaryColor }}
          animate={{ width: `${progressAnim}%` }}
          transition={{ duration: 0.45, ease: 'easeInOut' }}
        />
      </div>

      {/* Progress label */}
      <motion.div
        className="fixed top-[env(safe-area-inset-top,12px)] right-4 z-50 text-xs font-semibold tabular-nums"
        style={{ color: theme.primaryColor }}
        animate={{ opacity: progressAnim > 0 ? 1 : 0 }}
        transition={{ duration: 0.3 }}
      >
        {Math.round(progressAnim)}%
      </motion.div>
      </>)}

      {/* ── Main content ── */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 pt-8 sm:pt-14 pb-28 sm:pb-24">
        <div className="w-full max-w-2xl" role="form" aria-label={form.title || 'Formulário'}>
          {/* Honeypot anti-spam */}
          <input type="text" name="_hp_" autoComplete="off" tabIndex={-1} aria-hidden="true" style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0, width: 0 }} />
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={currentQuestion?.id ?? currentIndex}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.38, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              {!isContentStep && (
                <>
                  {/* Question number */}
                  <div role="heading" aria-level={1} className="sr-only">Formulário: {form.title}</div>
                  <motion.div
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.07 }}
                    className="mb-5 flex items-center gap-2"
                  >
                    <span className="text-sm font-bold tabular-nums" style={{ color: theme.primaryColor }}>
                      Pergunta {currentIndex + 1} de {visibleQuestions.length}
                    </span>
                    {visibleQuestions.length !== questionCount && (
                      <span className="text-xs opacity-50" style={{ color: theme.textColor }}>
                        ({questionCount} total)
                      </span>
                    )}
                  </motion.div>

                  {/* Title */}
                  <motion.h2
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.12 }}
                    className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold mb-3 leading-snug"
                    style={{ color: theme.textColor }}
                  >
                    {currentQuestion.title || 'Pergunta sem título'}
                    {currentQuestion.required && (
                      <span style={{ color: theme.primaryColor }} className="ml-1">*</span>
                    )}
                  </motion.h2>

                  {currentQuestion.description && (
                    <motion.p
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.17 }}
                      className="text-base md:text-lg opacity-70 mb-6 sm:mb-8"
                      style={{ color: theme.textColor }}
                    >
                      {currentQuestion.description}
                    </motion.p>
                  )}
                </>
              )}

              {/* Input */}
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.22 }}
                className="mt-8"
              >
                <QuestionRenderer
                  question={currentQuestion}
                  value={answers[currentQuestion.id]}
                  onChange={(value) => updateAnswer(currentQuestion.id, value)}
                  theme={theme}
                  error={errors[currentQuestion.id]}
                  onSubmit={(skipValidation?: boolean, valueOverride?: Json) => {
                    const pendingAnswer = valueOverride !== undefined
                      ? { questionId: currentQuestion.id, value: valueOverride }
                      : undefined

                    if (skipValidation) skipNextValidationRef.current = true
                    goToNext(skipValidation, pendingAnswer)
                  }}
                  onClearError={() => {
                    setErrors(prev => { const e = { ...prev }; delete e[currentQuestion.id]; return e })
                  }}
                />
              </motion.div>

              {/* Error */}
              <AnimatePresence>
                {errors[currentQuestion.id] && (
                  <motion.p
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="mt-4 text-sm font-medium"
                    style={{ color: '#EF4444' }}
                  >
                    {errors[currentQuestion.id]}
                  </motion.p>
                )}
              </AnimatePresence>

              {!isContentStep && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.27 }}
                  className="mt-6 sm:mt-8 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3 sm:gap-4 relative z-10"
                >
                  <Button
                    onClick={() => goToNext()}
                    disabled={isSubmitting}
                    className="h-12 px-7 text-base font-semibold rounded-xl transition-transform active:scale-95 w-full sm:w-auto"
                    style={{ backgroundColor: theme.primaryColor, color: theme.backgroundColor }}
                    aria-label={isLastQuestion ? 'Enviar resposta' : 'Confirmar e avançar'}
                  >
                    {isSubmitting ? (
                      <span className="flex items-center gap-2">
                        <motion.span
                          animate={{ rotate: 360 }}
                          transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
                          className="block w-4 h-4 border-2 border-current border-t-transparent rounded-full"
                        />
                        Enviando…
                      </span>
                    ) : isLastQuestion ? (
                      <span className="flex items-center gap-2">Enviar <Check className="w-4 h-4" /></span>
                    ) : (
                      <span className="flex items-center gap-2">OK <Check className="w-4 h-4" /></span>
                    )}
                  </Button>

                  <span className="hidden sm:inline text-sm opacity-40" style={{ color: theme.textColor }}>
                    Pressione <kbd className="font-mono font-semibold">Enter ↵</kbd>
                  </span>
                </motion.div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* ── Nav footer ── */}
      <footer className="fixed bottom-0 left-0 right-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] flex items-center justify-between backdrop-blur-sm" style={{ backgroundColor: `${theme.backgroundColor}CC` }} role="navigation" aria-label="Navegação do formulário">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={goToPrevious}
            disabled={isFirstQuestion}
            className="h-11 w-11 p-0 rounded-lg"
            style={{ color: theme.textColor }}
            aria-label="Pergunta anterior"
          >
            <ChevronUp className="w-5 h-5" />
          </Button>
          {!isContentStep && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => goToNext()}
              disabled={isSubmitting}
              className="h-11 w-11 p-0 rounded-lg"
              style={{ color: theme.textColor }}
              aria-label="Próxima pergunta"
            >
              <ChevronDown className="w-5 h-5" />
            </Button>
          )}
        </div>

        {!form.hide_branding && (
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] opacity-60 hover:opacity-90 transition-opacity"
            style={{ color: theme.textColor }}
          >
            Feito com <span className="font-semibold">EidosForm</span>
          </a>
        )}
      </footer>
    </div>
  )
}, (prevProps, nextProps) => {
  // Memoização customizada: apenas re-render se form.id ou ownerPlan mudar
  return prevProps.form.id === nextProps.form.id && 
         prevProps.ownerPlan === nextProps.ownerPlan
})
