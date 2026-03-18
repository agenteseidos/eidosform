'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Form, QuestionConfig, Json } from '@/lib/database.types'
import { getTheme, getThemeCSSVariables } from '@/lib/themes'
import { motion, AnimatePresence } from 'framer-motion'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { ChevronUp, ChevronDown, Check, ArrowRight } from 'lucide-react'
import { QuestionRenderer } from './question-renderer'
import { toast } from 'sonner'

interface FormPlayerProps {
  form: Form
}

function firePixels(form: Form) {
  const pixels = form.pixels as Record<string, string> | null
  if (!pixels) return

  // Meta Pixel
  if (pixels.metaPixelId) {
    const script = document.createElement('script')
    script.innerHTML = `
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
      fbq('init', '${pixels.metaPixelId}');
      fbq('track', 'Lead');
    `
    document.head.appendChild(script)
  }

  // TikTok Pixel
  if (pixels.tiktokPixelId) {
    const script = document.createElement('script')
    script.innerHTML = `
      !function (w, d, t) {
        w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=[page,track,identify,instances,debug,on,off,once,ready,alias,group,enableCookie,disableCookie],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
        ttq.load('${pixels.tiktokPixelId}');
        ttq.track('SubmitForm');
      }(window, document, 'ttq');
    `
    document.head.appendChild(script)
  }

  // Google Ads conversion
  if (pixels.googleAdsId && pixels.googleAdsLabel) {
    const gtag = document.createElement('script')
    gtag.src = `https://www.googletagmanager.com/gtag/js?id=${pixels.googleAdsId}`
    gtag.async = true
    document.head.appendChild(gtag)
    const script = document.createElement('script')
    script.innerHTML = `
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${pixels.googleAdsId}');
      gtag('event', 'conversion', {'send_to': '${pixels.googleAdsId}/${pixels.googleAdsLabel}'});
    `
    document.head.appendChild(script)
  }

  // GTM
  if (pixels.gtmId) {
    const script = document.createElement('script')
    script.innerHTML = `
      (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${pixels.gtmId}');
    `
    document.head.appendChild(script)
  }
}

export function FormPlayer({ form }: FormPlayerProps) {
  const supabase = createClient()
  const questions = (form.questions as QuestionConfig[]) || []
  const theme = getTheme(form.theme)
  const themeStyles = getThemeCSSVariables(theme)

  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, Json>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [direction, setDirection] = useState(0)
  
  const containerRef = useRef<HTMLDivElement>(null)
  const skipNextValidationRef = useRef(false)

  const currentQuestion = questions[currentIndex]
  const isLastQuestion = currentIndex === questions.length - 1
  const isFirstQuestion = currentIndex === 0
  const progress = questions.length > 0 ? ((currentIndex + 1) / questions.length) * 100 : 0

  const validateCurrentQuestion = useCallback(() => {
    if (!currentQuestion) return true
    
    const answer = answers[currentQuestion.id]
    
    if (currentQuestion.required) {
      if (answer === undefined || answer === null || answer === '') {
        setErrors({ ...errors, [currentQuestion.id]: 'Este campo é obrigatório' })
        return false
      }
      
      if (Array.isArray(answer) && answer.length === 0) {
        setErrors({ ...errors, [currentQuestion.id]: 'Selecione ao menos uma opção' })
        return false
      }
    }

    // Type-specific validation
    if (answer && currentQuestion.type === 'email') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(String(answer))) {
        setErrors({ ...errors, [currentQuestion.id]: 'Por favor, insira um e-mail válido' })
        return false
      }
    }

    if (answer && currentQuestion.type === 'url') {
      try {
        new URL(String(answer))
      } catch {
        setErrors({ ...errors, [currentQuestion.id]: 'Por favor, insira uma URL válida' })
        return false
      }
    }

    if (answer && currentQuestion.type === 'phone') {
      const phoneRegex = /^[+]?[\d\s\-().]+$/
      if (!phoneRegex.test(String(answer))) {
        setErrors({ ...errors, [currentQuestion.id]: 'Por favor, insira um telefone válido' })
        return false
      }
    }

    // Clear error if valid
    const newErrors = { ...errors }
    delete newErrors[currentQuestion.id]
    setErrors(newErrors)
    return true
  }, [currentQuestion, answers, errors])

  const goToNext = useCallback((skipValidation?: boolean) => {
    // Check both the parameter and the ref for skip validation
    const shouldSkip = skipValidation || skipNextValidationRef.current
    skipNextValidationRef.current = false // Reset the ref
    
    if (!shouldSkip && !validateCurrentQuestion()) return
    
    if (isLastQuestion) {
      handleSubmit()
    } else {
      setDirection(1)
      setCurrentIndex(prev => Math.min(prev + 1, questions.length - 1))
    }
  }, [isLastQuestion, questions.length, validateCurrentQuestion])

  const goToPrevious = useCallback(() => {
    setDirection(-1)
    setCurrentIndex(prev => Math.max(prev - 1, 0))
  }, [])

  const handleSubmit = async () => {
    if (!validateCurrentQuestion()) return
    
    setIsSubmitting(true)
    
    const insertData = {
      form_id: form.id,
      answers: answers,
    }
    const { error } = await supabase
      .from('responses')
      .insert(insertData as never)

    if (error) {
      toast.error('Falha ao enviar resposta')
      setIsSubmitting(false)
    } else {
      // Fire tracking pixels on successful submission
      firePixels(form)
      setIsSubmitted(true)
    }
  }

  const updateAnswer = (questionId: string, value: Json) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }))
    // Clear error when user starts typing
    if (errors[questionId]) {
      const newErrors = { ...errors }
      delete newErrors[questionId]
      setErrors(newErrors)
    }
  }

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isSubmitted || isSubmitting) return
      
      if (e.key === 'Enter' && !e.shiftKey) {
        // Don't submit on enter for textarea
        if (currentQuestion?.type === 'long_text') {
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            goToNext()
          }
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
        e.preventDefault()
        goToNext()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentQuestion, goToNext, goToPrevious, isSubmitted, isSubmitting])

  // Scroll/wheel navigation
  useEffect(() => {
    let lastScrollTime = 0
    const scrollThreshold = 500 // ms between scroll navigations
    const deltaThreshold = 50 // minimum scroll delta to trigger navigation

    const handleWheel = (e: WheelEvent) => {
      if (isSubmitted || isSubmitting) return
      
      // Don't interfere with scrollable inputs like textarea
      const target = e.target as HTMLElement
      if (target.tagName === 'TEXTAREA') return
      
      const now = Date.now()
      if (now - lastScrollTime < scrollThreshold) return
      
      // Check if scroll delta is significant enough
      if (Math.abs(e.deltaY) < deltaThreshold) return
      
      if (e.deltaY > 0) {
        // Scrolling down - go to next question
        goToNext()
      } else {
        // Scrolling up - go to previous question
        goToPrevious()
      }
      
      lastScrollTime = now
    }

    window.addEventListener('wheel', handleWheel, { passive: true })
    return () => window.removeEventListener('wheel', handleWheel)
  }, [goToNext, goToPrevious, isSubmitted, isSubmitting])

  // Thank you screen
  if (isSubmitted) {
    // Redirect if configured
    if (form.redirect_url) {
      window.location.href = form.redirect_url
    }

    return (
      <div 
        className="min-h-screen flex items-center justify-center p-6"
        style={{ 
          ...themeStyles,
          backgroundColor: theme.backgroundColor,
          fontFamily: theme.fontFamily,
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center max-w-lg w-full px-4"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            className="w-20 h-20 mx-auto mb-8 rounded-full flex items-center justify-center"
            style={{ backgroundColor: `${theme.primaryColor}20` }}
          >
            <Check className="w-10 h-10" style={{ color: theme.primaryColor }} />
          </motion.div>
          <h1 
            className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4 leading-tight"
            style={{ color: theme.textColor }}
          >
            {form.thank_you_message || 'Obrigado!'}
          </h1>
          <p 
            className="text-base md:text-lg opacity-70"
            style={{ color: theme.textColor }}
          >
            Sua resposta foi registrada com sucesso.
          </p>
          
          {/* EidosForm branding */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="mt-12"
          >
            <a 
              href="/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm opacity-50 hover:opacity-70 transition-opacity"
              style={{ color: theme.textColor }}
            >
              <span>Feito com</span>
              <span className="font-semibold">EidosForm</span>
            </a>
          </motion.div>
        </motion.div>
      </div>
    )
  }

  // Empty form
  if (questions.length === 0) {
    return (
      <div 
        className="min-h-screen flex items-center justify-center p-6"
        style={{ 
          backgroundColor: theme.backgroundColor,
          fontFamily: theme.fontFamily,
        }}
      >
        <p style={{ color: theme.textColor }} className="opacity-50">
          This form has no questions yet.
        </p>
      </div>
    )
  }

  const slideVariants = {
    enter: (direction: number) => ({
      y: direction > 0 ? 100 : -100,
      opacity: 0,
    }),
    center: {
      y: 0,
      opacity: 1,
    },
    exit: (direction: number) => ({
      y: direction > 0 ? -100 : 100,
      opacity: 0,
    }),
  }

  return (
    <div 
      ref={containerRef}
      className="min-h-screen flex flex-col"
      style={{ 
        ...themeStyles,
        backgroundColor: theme.backgroundColor,
        fontFamily: theme.fontFamily,
      }}
    >
      {/* Progress bar */}
      <div className="fixed top-0 left-0 right-0 z-50">
        <Progress 
          value={progress} 
          className="h-1 rounded-none"
          style={{ 
            backgroundColor: `${theme.primaryColor}20`,
          }}
          indicatorStyle={{
            backgroundColor: theme.primaryColor,
          }}
        />
      </div>

      {/* Main content */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 pt-12 pb-24">
        <div className="w-full max-w-2xl">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={currentIndex}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: 'easeInOut' }}
            >
              {/* Question number */}
              <motion.div 
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 }}
                className="mb-6 flex items-center gap-2"
              >
                <span 
                  className="text-base font-medium"
                  style={{ color: theme.primaryColor }}
                >
                  {currentIndex + 1}
                </span>
                <ArrowRight className="w-4 h-4" style={{ color: theme.primaryColor }} />
              </motion.div>

              {/* Question */}
              <motion.h2 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold mb-3"
                style={{ color: theme.textColor }}
              >
                {currentQuestion.title || 'Untitled question'}
                {currentQuestion.required && (
                  <span style={{ color: theme.primaryColor }} className="ml-1">*</span>
                )}
              </motion.h2>

              {currentQuestion.description && (
                <motion.p 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="text-base md:text-lg opacity-70 mb-6 sm:mb-8"
                  style={{ color: theme.textColor }}
                >
                  {currentQuestion.description}
                </motion.p>
              )}

              {/* Answer input */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
                className="mt-8"
              >
                <QuestionRenderer
                  question={currentQuestion}
                  value={answers[currentQuestion.id]}
                  onChange={(value) => updateAnswer(currentQuestion.id, value)}
                  theme={theme}
                  error={errors[currentQuestion.id]}
                  onSubmit={(skipValidation?: boolean) => {
                    if (skipValidation) {
                      skipNextValidationRef.current = true
                    }
                    goToNext(skipValidation)
                  }}
                  onClearError={() => {
                    if (errors[currentQuestion.id]) {
                      const newErrors = { ...errors }
                      delete newErrors[currentQuestion.id]
                      setErrors(newErrors)
                    }
                  }}
                />
              </motion.div>

              {/* Error message */}
              <AnimatePresence>
                {errors[currentQuestion.id] && (
                  <motion.p
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="mt-4 text-sm font-medium"
                    style={{ color: '#EF4444' }}
                  >
                    {errors[currentQuestion.id]}
                  </motion.p>
                )}
              </AnimatePresence>

              {/* Action buttons */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="mt-6 sm:mt-8 flex flex-wrap items-center gap-3 sm:gap-4"
              >
                <Button
                  onClick={() => goToNext()}
                  disabled={isSubmitting}
                  className="h-12 px-6 text-base font-medium"
                  style={{ 
                    backgroundColor: theme.primaryColor,
                    color: theme.backgroundColor,
                  }}
                >
                  {isSubmitting ? (
                    'Enviando...'
                  ) : isLastQuestion ? (
                    <>
                      Enviar
                      <Check className="w-4 h-4 ml-2" />
                    </>
                  ) : (
                    <>
                      OK
                      <Check className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>

                <span 
                  className="text-sm opacity-50"
                  style={{ color: theme.textColor }}
                >
                  pressione <kbd className="font-mono font-medium">Enter ↵</kbd>
                </span>
              </motion.div>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Navigation footer */}
      <footer className="fixed bottom-0 left-0 right-0 p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={goToPrevious}
            disabled={isFirstQuestion}
            className="h-10 w-10 p-0"
            style={{ color: theme.textColor }}
          >
            <ChevronUp className="w-5 h-5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => goToNext()}
            disabled={isSubmitting}
            className="h-10 w-10 p-0"
            style={{ color: theme.textColor }}
          >
            <ChevronDown className="w-5 h-5" />
          </Button>
        </div>

        {/* EidosForm branding */}
        <a 
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm opacity-50 hover:opacity-70 transition-opacity"
          style={{ color: theme.textColor }}
        >
          Feito com <span className="font-semibold">EidosForm</span>
        </a>
      </footer>
    </div>
  )
}

