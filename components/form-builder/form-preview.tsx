'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { QuestionConfig } from '@/lib/database.types'
import { ThemeConfig } from '@/lib/database.types'
import { motion, AnimatePresence } from 'framer-motion'
import { Star, CalendarClock } from 'lucide-react'
import { getCountryByCode } from '@/lib/countries'

interface FormPreviewProps {
  questions: QuestionConfig[]
  theme: ThemeConfig
  selectedQuestionId: string | null
  onSelectQuestion: (id: string) => void
  onUpdateQuestion?: (id: string, updates: Partial<QuestionConfig>) => void
}

// B05: Inline editable text component
function InlineEditableText({
  value,
  placeholder,
  onSave,
  className,
  style,
  tag = 'h3',
}: {
  value: string
  placeholder: string
  onSave: (newValue: string) => void
  className?: string
  style?: React.CSSProperties
  tag?: 'h3' | 'p'
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(value)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)

  useEffect(() => {
    setEditValue(value)
  }, [value])

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      // Select all text for easy replacement
      if ('select' in inputRef.current) {
        inputRef.current.select()
      }
    }
  }, [isEditing])

  const handleSave = useCallback(() => {
    setIsEditing(false)
    if (editValue !== value) {
      onSave(editValue)
    }
  }, [editValue, value, onSave])

  if (isEditing) {
    const InputTag = tag === 'p' ? 'textarea' : 'input'
    return (
      <InputTag
        ref={inputRef as React.Ref<HTMLInputElement & HTMLTextAreaElement>}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && tag !== 'p') {
            e.preventDefault()
            handleSave()
          }
          if (e.key === 'Escape') {
            setEditValue(value)
            setIsEditing(false)
          }
        }}
        className={`${className} bg-transparent border-0 outline-none w-full resize-none cursor-text`}
        style={style}
        placeholder={placeholder}
        rows={tag === 'p' ? 2 : undefined}
      />
    )
  }

  return (
    <div
      onClick={(e) => {
        e.stopPropagation()
        setIsEditing(true)
      }}
      className={`${className} cursor-text hover:bg-white/10 rounded px-1 -mx-1 transition-colors group relative`}
      style={style}
      title="Clique para editar"
    >
      {value || <span className="opacity-40 italic">{placeholder}</span>}
      <span className="absolute -top-1 -right-1 text-[10px] bg-blue-500 text-white px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        editar
      </span>
    </div>
  )
}

export function FormPreview({ 
  questions, 
  theme, 
  selectedQuestionId, 
  onSelectQuestion,
  onUpdateQuestion,
}: FormPreviewProps) {
  // B13: Preview "uma pergunta por vez" — mostra apenas a questão selecionada (ou a primeira)
  const activeQuestionId = selectedQuestionId || (questions.length > 0 ? questions[0].id : null)
  const activeQuestion = questions.find(q => q.id === activeQuestionId)
  const activeIndex = activeQuestion ? questions.indexOf(activeQuestion) : 0

  if (questions.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px] p-8">
        <div className="text-center">
          <p style={{ color: theme.textColor }} className="opacity-50">
            Adicione perguntas para ver a visualização
          </p>
        </div>
      </div>
    )
  }

  if (!activeQuestion) return null

  const question = activeQuestion
  const index = activeIndex

  return (
    <div className="p-8">
      <AnimatePresence mode="wait">
        <motion.div
          key={question.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.25 }}
          className="p-6 rounded-xl cursor-pointer transition-all ring-2 ring-offset-2"
          style={{ 
            backgroundColor: `${theme.primaryColor}10`,
            '--tw-ring-color': theme.primaryColor,
          } as React.CSSProperties}
          onClick={() => onSelectQuestion(question.id)}
        >
          <div className="mb-4">
            <span 
              className="text-sm font-medium opacity-60"
              style={{ color: theme.textColor }}
            >
              {index + 1} →
            </span>
          </div>
          
          {/* B05: Título editável inline */}
          <div className="flex items-start gap-1 mb-2">
            {onUpdateQuestion ? (
              <InlineEditableText
                value={question.title}
                placeholder="Pergunta sem título"
                onSave={(newTitle) => onUpdateQuestion(question.id, { title: newTitle })}
                className="text-xl font-semibold"
                style={{ color: theme.textColor }}
              />
            ) : (
              <h3 className="text-xl font-semibold" style={{ color: theme.textColor }}>
                {question.title || 'Pergunta sem título'}
              </h3>
            )}
            {question.required && (
              <span style={{ color: theme.primaryColor }} className="text-xl ml-1">*</span>
            )}
          </div>
          
          {/* B05: Descrição editável inline */}
          {onUpdateQuestion ? (
            <InlineEditableText
              value={question.description || ''}
              placeholder="Adicionar descrição (opcional)"
              onSave={(newDesc) => onUpdateQuestion(question.id, { description: newDesc || '' })}
              className="text-sm opacity-70 mb-4"
              style={{ color: theme.textColor }}
              tag="p"
            />
          ) : (
            question.description && (
              <p className="text-sm opacity-70 mb-4" style={{ color: theme.textColor }}>
                {question.description}
              </p>
            )
          )}

          {/* Preview of input types */}
          <div className="mt-4">
            {question.type === 'phone' && (() => {
              const country = getCountryByCode(question.defaultCountry || 'BR')
              return (
                <div className="flex items-end gap-2">
                  <div
                    className="border-b-2 py-2 text-lg opacity-50 flex items-center gap-1.5 whitespace-nowrap"
                    style={{ borderColor: theme.primaryColor, color: theme.textColor }}
                  >
                    <span>{country.flag}</span>
                    <span className="text-base">{country.dial}</span>
                    <span className="text-xs">▾</span>
                  </div>
                  <div
                    className="flex-1 border-b-2 py-2 text-lg opacity-50"
                    style={{ borderColor: theme.primaryColor, color: theme.textColor }}
                  >
                    {country.format}
                  </div>
                </div>
              )
            })()}

            {(question.type === 'short_text' || question.type === 'email' || 
              question.type === 'url' || 
              question.type === 'number') && (
              <div 
                className="border-b-2 py-2 text-lg opacity-50"
                style={{ 
                  borderColor: theme.primaryColor,
                  color: theme.textColor 
                }}
              >
                {question.placeholder || 'Digite sua resposta aqui...'}
              </div>
            )}

            {question.type === 'long_text' && (
              <div 
                className="border-2 rounded-lg p-3 opacity-50 min-h-[80px]"
                style={{ 
                  borderColor: `${theme.primaryColor}40`,
                  color: theme.textColor 
                }}
              >
                {question.placeholder || 'Digite sua resposta aqui...'}
              </div>
            )}

            {question.type === 'date' && (
              <div 
                className="border-b-2 py-2 text-lg opacity-50"
                style={{ 
                  borderColor: theme.primaryColor,
                  color: theme.textColor 
                }}
              >
                DD / MM / AAAA
              </div>
            )}

            {(question.type === 'dropdown' || question.type === 'checkboxes') && (
              <div className="space-y-2">
                {(question.options || []).map((option, i) => (
                  <div 
                    key={i}
                    className="flex items-center gap-3 p-3 rounded-lg border-2 transition-colors hover:border-opacity-100"
                    style={{ 
                      borderColor: `${theme.primaryColor}40`,
                      color: theme.textColor 
                    }}
                  >
                    <div 
                      className={`w-6 h-6 rounded-${question.type === 'dropdown' ? 'full' : 'md'} border-2 flex items-center justify-center`}
                      style={{ borderColor: theme.primaryColor }}
                    >
                      <span className="text-xs font-medium" style={{ color: theme.primaryColor }}>
                        {String.fromCharCode(65 + i)}
                      </span>
                    </div>
                    <span>{option}</span>
                  </div>
                ))}
              </div>
            )}

            {question.type === 'yes_no' && (
              <div className="flex gap-3">
                {['Sim', 'Não'].map((option, i) => (
                  <div 
                    key={i}
                    className="flex items-center gap-3 p-3 rounded-lg border-2 flex-1 justify-center transition-colors"
                    style={{ 
                      borderColor: `${theme.primaryColor}40`,
                      color: theme.textColor 
                    }}
                  >
                    <div 
                      className="w-6 h-6 rounded-md border-2 flex items-center justify-center"
                      style={{ borderColor: theme.primaryColor }}
                    >
                      <span className="text-xs font-medium" style={{ color: theme.primaryColor }}>
                        {option[0]}
                      </span>
                    </div>
                    <span>{option}</span>
                  </div>
                ))}
              </div>
            )}

            {question.type === 'rating' && (
              <div className="flex gap-2">
                {Array.from({ length: question.maxValue || 5 }).map((_, i) => (
                  <Star 
                    key={i}
                    className="w-8 h-8"
                    style={{ color: `${theme.primaryColor}40` }}
                  />
                ))}
              </div>
            )}

            {question.type === 'opinion_scale' && (
              <div className="flex gap-2">
                {Array.from({ length: (question.maxValue || 10) - (question.minValue || 1) + 1 }).map((_, i) => (
                  <div 
                    key={i}
                    className="w-10 h-10 rounded-lg border-2 flex items-center justify-center text-sm font-medium"
                    style={{ 
                      borderColor: `${theme.primaryColor}40`,
                      color: theme.textColor 
                    }}
                  >
                    {(question.minValue || 1) + i}
                  </div>
                ))}
              </div>
            )}

            {question.type === 'file_upload' && (
              <div 
                className="border-2 border-dashed rounded-lg p-6 text-center opacity-70"
                style={{ 
                  borderColor: `${theme.primaryColor}40`,
                  color: theme.textColor 
                }}
              >
                <p className="text-sm">Arraste arquivos ou clique para enviar</p>
                <p className="text-xs opacity-60 mt-1">
                  Imagens e PDFs até {question.maxFileSize || 10}MB
                </p>
              </div>
            )}

            {question.type === 'calendly' && (
              question.calendlyUrl ? (
                <div
                  className="overflow-hidden rounded-2xl border bg-white"
                  style={{ borderColor: `${theme.primaryColor}30` }}
                >
                  <div
                    className="flex items-center gap-2 border-b px-4 py-3 text-sm"
                    style={{
                      borderColor: `${theme.primaryColor}20`,
                      color: theme.textColor,
                      backgroundColor: `${theme.primaryColor}08`,
                    }}
                  >
                    <CalendarClock className="w-4 h-4" style={{ color: theme.primaryColor }} />
                    <span className="font-medium">Prévia do embed Calendly</span>
                  </div>
                  <iframe
                    src={question.calendlyUrl}
                    title="Prévia do Calendly"
                    className="h-[520px] w-full bg-white"
                  />
                </div>
              ) : (
                <div
                  className="rounded-2xl border-2 border-dashed px-6 py-10 text-center"
                  style={{
                    borderColor: `${theme.primaryColor}35`,
                    backgroundColor: `${theme.primaryColor}08`,
                    color: theme.textColor,
                  }}
                >
                  <div
                    className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
                    style={{ backgroundColor: `${theme.primaryColor}16` }}
                  >
                    <CalendarClock className="w-7 h-7" style={{ color: theme.primaryColor }} />
                  </div>
                  <p className="text-base font-medium">Widget Calendly será exibido aqui</p>
                  <p className="mt-2 text-sm opacity-60">Configure a URL do Calendly no painel direito para ativar a prévia.</p>
                </div>
              )
            )}
          </div>


            {question.type === 'address' && (
              <div className="space-y-2">
                {['CEP', 'Rua', 'Número', 'Complemento', 'Bairro', 'Cidade', 'Estado'].map((field, i) => (
                  <div
                    key={i}
                    className="border-b-2 py-1.5 text-sm opacity-50"
                    style={{ borderColor: `${theme.primaryColor}40`, color: theme.textColor }}
                  >
                    {field}
                  </div>
                ))}
              </div>
            )}

          {/* Keyboard hint */}
          <div className="mt-6 flex items-center gap-2 opacity-50">
            <span className="text-xs" style={{ color: theme.textColor }}>Pressione</span>
            <kbd 
              className="px-2 py-1 rounded text-xs font-medium"
              style={{ 
                backgroundColor: `${theme.primaryColor}20`,
                color: theme.textColor 
              }}
            >
              Enter ↵
            </kbd>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* B13: Navegação entre perguntas no preview */}
      <div className="flex items-center justify-between mt-4 text-xs" style={{ color: theme.textColor }}>
        <span className="opacity-40">
          Pergunta {index + 1} de {questions.length}
        </span>
        <div className="flex gap-1">
          {questions.map((q, i) => (
            <button
              key={q.id}
              onClick={() => onSelectQuestion(q.id)}
              className="w-2 h-2 rounded-full transition-all"
              style={{
                backgroundColor: q.id === activeQuestionId ? theme.primaryColor : `${theme.textColor}30`,
              }}
              title={`Pergunta ${i + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

