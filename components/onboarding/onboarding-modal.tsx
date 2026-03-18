'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useRouter } from 'next/navigation'
import { FileText, Palette, Rocket, ArrowRight, Check } from 'lucide-react'

const steps = [
  {
    id: 1,
    icon: Rocket,
    emoji: '👋',
    title: 'Bem-vindo ao EidosForm!',
    description: 'Você está a poucos passos de criar formulários bonitos que as pessoas adoram responder. Uma pergunta de cada vez.',
    highlight: 'Simples. Bonito. Eficiente.',
    color: 'blue',
  },
  {
    id: 2,
    icon: FileText,
    emoji: '📝',
    title: 'Crie seu primeiro formulário',
    description: 'Escolha entre 10 templates prontos ou comece do zero. Arraste, solte e configure cada pergunta do seu jeito.',
    highlight: 'Leva menos de 5 minutos.',
    color: 'violet',
  },
  {
    id: 3,
    icon: Palette,
    emoji: '🎨',
    title: 'Personalize e publique',
    description: 'Escolha cores, fontes e estilo. Depois compartilhe o link com o mundo — ou incorpore no seu site.',
    highlight: 'Seu formulário, sua identidade.',
    color: 'green',
  },
]

const colorMap = {
  blue: { bg: 'bg-blue-50', icon: 'bg-blue-100 text-blue-600', dot: 'bg-blue-600', text: 'text-blue-700', button: 'bg-blue-600 hover:bg-blue-700' },
  violet: { bg: 'bg-violet-50', icon: 'bg-violet-100 text-violet-600', dot: 'bg-violet-600', text: 'text-violet-700', button: 'bg-violet-600 hover:bg-violet-700' },
  green: { bg: 'bg-green-50', icon: 'bg-green-100 text-green-600', dot: 'bg-green-600', text: 'text-green-700', button: 'bg-green-600 hover:bg-green-700' },
}

interface OnboardingModalProps {
  open: boolean
  onClose: () => void
}

export function OnboardingModal({ open, onClose }: OnboardingModalProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const router = useRouter()

  const step = steps[currentStep]
  const colors = colorMap[step.color as keyof typeof colorMap]
  const Icon = step.icon

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      onClose()
      router.push('/forms/new')
    }
  }

  const handleSkip = () => {
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden border-0 shadow-2xl">
        {/* Header colorido */}
        <div className={`${colors.bg} px-8 pt-10 pb-8 text-center`}>
          <div className="text-5xl mb-4">{step.emoji}</div>
          <div className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl ${colors.icon} mb-4`}>
            <Icon className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">{step.title}</h2>
          <p className={`text-sm font-semibold ${colors.text}`}>{step.highlight}</p>
        </div>

        {/* Body */}
        <div className="px-8 py-6">
          <p className="text-slate-600 text-sm leading-relaxed text-center mb-6">
            {step.description}
          </p>

          {/* Indicadores de passo */}
          <div className="flex items-center justify-center gap-2 mb-6">
            {steps.map((s, i) => (
              <div
                key={s.id}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === currentStep
                    ? `w-6 ${colors.dot}`
                    : i < currentStep
                    ? `w-3 bg-slate-300`
                    : 'w-3 bg-slate-100'
                }`}
              />
            ))}
          </div>

          {/* Checklist visual para passos anteriores */}
          {currentStep > 0 && (
            <div className="space-y-1.5 mb-5">
              {steps.slice(0, currentStep).map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-xs text-slate-400">
                  <div className="w-4 h-4 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                    <Check className="w-2.5 h-2.5 text-green-600" />
                  </div>
                  {s.title}
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <Button
              variant="ghost"
              className="flex-1 text-slate-500 hover:text-slate-700"
              onClick={handleSkip}
            >
              Pular
            </Button>
            <Button
              className={`flex-1 font-semibold text-white ${colors.button} transition-all`}
              onClick={handleNext}
            >
              {currentStep === steps.length - 1 ? (
                <>Criar formulário <Rocket className="w-4 h-4 ml-2" /></>
              ) : (
                <>Próximo <ArrowRight className="w-4 h-4 ml-2" /></>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
