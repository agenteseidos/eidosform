'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Form, QuestionConfig, Json } from '@/lib/database.types'
import { PixelEventRule } from '@/types/pixel-events'
import { getTheme, getThemeCSSVariables } from '@/lib/themes'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { ChevronUp, ChevronDown, Check, ArrowRight, Lock } from 'lucide-react'
import { QuestionRenderer } from './question-renderer'
import { toast } from 'sonner'
import { PixelInjector } from '@/components/pixels/pixel-injector'
import { evaluatePixelEvents, fireNamedPixelEvent } from '@/lib/pixel-events'
import { evaluateJumpRules, getVisibleQuestions } from '@/lib/form-logic-engine'
import { captureUtms, getUtms } from '@/lib/utm-tracker'

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

export function FormPlayer({ form, ownerPlan = 'free' }: FormPlayerProps) {
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

  const containerRef = useRef<HTMLDivElement>(null)
  const triggerPixelSubmitRef = useRef<(() => void) | null>(null)
  const skipNextValidationRef = useRef(false)

  // Lista de perguntas visíveis com base nas respostas atuais
  const visibleQuestions = getVisibleQuestions(questions, answers) as QuestionConfig[]

  const currentQuestion = visibleQuestions[currentIndex]
  const isContentStep = currentQuestion?.type === 'content_block'
  const isLastQuestion = currentIndex === visibleQuestions.length - 1
  const isFirstQuestion = form.welcome_enabled ? currentIndex === -1 : currentIndex === 0
  // Com jump logic, progresso baseado em perguntas respondidas + posição atual
  const answeredCount = visibleQuestions.filter(q => answers[q.id] !== undefined && answers[q.id] !== '').length
  const progressFull = visibleQuestions.length > 0
    ? Math.max(((currentIndex + 1) / visibleQuestions.length) * 100, (answeredCount / visibleQuestions.length) * 100)
    : 0

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
      savePartialResponse(updatedAnswers, currentQuestion.id).catch(console.warn)
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

  // Salva resposta parcial a cada pergunta respondida (upsert por responseId)
  async function savePartialResponse(currentAnswers: Record<string, Json>, lastQuestionId: string) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (responseId) headers['x-response-id'] = responseId

      const res = await fetch('/api/responses', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          form_id: form.id,
          answers: currentAnswers,
          completed: false,
          last_question_answered: lastQuestionId,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        if (!responseId && data.response_id) {
          setResponseId(data.response_id)
        }
      }
    } catch (e) {
      // Falha silenciosa — não impede o fluxo do player
      console.warn('Partial save failed:', e)
    }
  }

  const handleSubmit = async (submissionAnswers?: Record<string, Json>) => {
    const finalAnswers = submissionAnswers ?? answers

    if (!validateCurrentQuestion(finalAnswers)) return
    setIsSubmitting(true)

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (responseId) headers['x-response-id'] = responseId

      const utms = getUtms()

      const res = await fetch('/api/responses', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          form_id: form.id,
          answers: finalAnswers,
          completed: true,
          last_question_answered: currentQuestion?.id ?? null,
          ...utms,
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
        setTimeout(() => { window.location.href = ensureHttps(form.redirect_url!) }, 2800)
      }
    } catch (e) {
      toast.error('Falha ao enviar resposta')
      setIsSubmitting(false)
    }
  }

  const updateAnswer = (questionId: string, value: Json) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }))
    if (errors[questionId]) {
      setErrors(prev => { const e = { ...prev }; delete e[questionId]; return e })
    }
  }

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
        e.preventDefault()
        goToPrevious()
      }

      if (e.key === 'ArrowDown') {
        if (currentQuestion?.type === 'content_block') {
          e.preventDefault()
          return
        }
        e.preventDefault()
        goToNext()
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
        {form.pixels && (ownerPlan === 'plus' || ownerPlan === 'professional') && (() => {
          const px = form.pixels as Record<string, string>
          const metaId = px.metaPixelId || px.facebook || px.pixel_meta || null
          const googleAdsId = px.googleAdsId || px.google_ads_id || null
          const googleAdsLabel = px.googleAdsLabel || px.google_ads_label || null
          const tiktokId = px.tiktokPixelId || px.tiktok_pixel_id || null
          const gtmId = px.gtmId || px.gtm_id || null
          if (!metaId && !googleAdsId && !tiktokId && !gtmId) return null
          return (
            <PixelInjector
              config={{
                meta_pixel_id: metaId,
                google_ads_id: googleAdsId,
                google_ads_label: googleAdsLabel,
                tiktok_pixel_id: tiktokId,
                gtm_id: gtmId,
              }}
              onReady={(trigger) => { triggerPixelSubmitRef.current = trigger }}
            />
          )
        })()}
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
              <img src={form.welcome_image_url} className="max-h-20 object-contain mx-auto mb-4" alt="" />
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
              onClick={() => {
                setDirection(1)
                setCurrentIndex(0)
                if (form.pixel_event_on_start) fireNamedPixelEvent(form.pixel_event_on_start)
              }}
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

      {/* Pixel tracking — suporta camelCase (metaPixelId) e snake_case (pixel_meta) */}
      {form.pixels && (ownerPlan === 'plus' || ownerPlan === 'professional') && (() => {
        const px = form.pixels as Record<string, string>
        const metaId = px.metaPixelId || px.facebook || px.pixel_meta || null
        const googleAdsId = px.googleAdsId || px.google_ads_id || null
        const googleAdsLabel = px.googleAdsLabel || px.google_ads_label || null
        const tiktokId = px.tiktokPixelId || px.tiktok_pixel_id || null
        const gtmId = px.gtmId || px.gtm_id || null
        if (!metaId && !googleAdsId && !tiktokId && !gtmId) return null
        return (
          <PixelInjector
            config={{
              meta_pixel_id: metaId,
              google_ads_id: googleAdsId,
              google_ads_label: googleAdsLabel,
              tiktok_pixel_id: tiktokId,
              gtm_id: gtmId,
            }}
            onReady={(trigger) => { triggerPixelSubmitRef.current = trigger }}
          />
        )
      })()}

      {/* ── Progress bar ── */}
      <div className="fixed top-0 left-0 right-0 z-50 h-[4px]" style={{ backgroundColor: `${theme.primaryColor}20` }}>
        <motion.div
          className="h-full rounded-r-full"
          style={{ backgroundColor: theme.primaryColor }}
          animate={{ width: `${progressAnim}%` }}
          transition={{ duration: 0.45, ease: 'easeInOut' }}
        />
      </div>

      {/* Progress label */}
      <motion.div
        className="fixed top-3 right-4 z-50 text-xs font-semibold tabular-nums"
        style={{ color: theme.primaryColor }}
        animate={{ opacity: progressAnim > 0 ? 1 : 0 }}
        transition={{ duration: 0.3 }}
      >
        {Math.round(progressAnim)}%
      </motion.div>

      {/* ── Main content ── */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 pt-8 sm:pt-14 pb-24">
        <div className="w-full max-w-2xl">
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
                  <motion.div
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.07 }}
                    className="mb-5 flex items-center gap-2"
                  >
                    <span className="text-sm font-bold tabular-nums" style={{ color: theme.primaryColor }}>
                      Pergunta {currentIndex + 1} de {visibleQuestions.length}
                    </span>
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
      <footer className="fixed bottom-0 left-0 right-0 p-4 flex items-center justify-between">
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
}
