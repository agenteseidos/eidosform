'use client'

import React, { useState, useRef, useCallback } from 'react'
import { QuestionConfig, ThemeConfig, Json } from '@/lib/database.types'
import { Input } from '@/components/ui/input'
import { formatCPF, validateCPF } from '@/lib/validators'
import { countries, getCountryByCode } from '@/lib/countries'
import { Textarea } from '@/components/ui/textarea'
import { motion } from 'framer-motion'
import { Star, Upload, Check, X, FileText, Image as ImageIcon, Loader2, AlertCircle, ExternalLink } from 'lucide-react'
import { renderContentBlockHtml } from '@/lib/content-block'

interface FileUploadValue {
  name: string
  url: string
  type: string
  size?: number
}

interface FileUploadQuestionProps {
  question: QuestionConfig
  value: FileUploadValue | null
  onChange: (value: FileUploadValue | null) => void
  theme: ThemeConfig
}

function FileUploadQuestion({ question, value, onChange, theme }: FileUploadQuestionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const handleFileSelect = useCallback(async (file: File) => {
    setUploadError(null)
    setIsUploading(true)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (!response.ok) {
        // If R2 is not configured, fall back to base64
        if (response.status === 503 && !result.configured) {
          // Fall back to base64 for local/demo usage
          const reader = new FileReader()
          reader.onload = () => {
            onChange({
              name: file.name,
              type: file.type,
              size: file.size,
              url: reader.result as string, // base64 data URL
            })
            setIsUploading(false)
          }
          reader.onerror = () => {
            setUploadError('Falha ao ler arquivo')
            setIsUploading(false)
          }
          reader.readAsDataURL(file)
          return
        }
        
        throw new Error(result.error || 'Falha no upload')
      }

      // Success - store the R2 URL
      onChange({
        name: result.file.name,
        type: result.file.type,
        size: result.file.size,
        url: result.url,
      })
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Falha no upload')
    } finally {
      setIsUploading(false)
    }
  }, [onChange])

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) {
            handleFileSelect(file)
          }
          // Reset input so same file can be selected again
          e.target.value = ''
        }}
      />
      
      {value ? (
        <div 
          className="p-4 rounded-xl border-2 flex items-center gap-4"
          style={{ borderColor: theme.primaryColor }}
        >
          <div 
            className="w-12 h-12 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `${theme.primaryColor}20` }}
          >
            {value.type?.startsWith('image/') ? (
              <ImageIcon className="w-6 h-6" style={{ color: theme.primaryColor }} />
            ) : (
              <FileText className="w-6 h-6" style={{ color: theme.primaryColor }} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate" style={{ color: theme.textColor }}>
              {value.name}
            </p>
            {value.size && (
              <p className="text-sm opacity-50" style={{ color: theme.textColor }}>
                {(value.size / 1024).toFixed(1)} KB
              </p>
            )}
          </div>
          <button
            onClick={() => onChange(null)}
            className="p-2 rounded-lg transition-colors hover:opacity-70"
            style={{ color: theme.textColor }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      ) : isUploading ? (
        <div 
          className="w-full p-8 rounded-xl border-2 border-dashed flex flex-col items-center gap-3"
          style={{ 
            borderColor: theme.primaryColor,
            color: theme.textColor,
          }}
        >
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: theme.primaryColor }} />
          <p className="font-medium">Enviando...</p>
        </div>
      ) : (
        <div>
          <motion.button
            type="button"
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={() => fileInputRef.current?.click()}
            className="w-full p-8 rounded-xl border-2 border-dashed flex flex-col items-center gap-3 transition-colors"
            style={{ 
              borderColor: uploadError ? '#EF4444' : `${theme.textColor}30`,
              color: theme.textColor,
            }}
          >
            <Upload className="w-8 h-8 opacity-50" />
            <div className="text-center">
              <p className="font-medium">Clique para enviar</p>
              <p className="text-sm opacity-50 mt-1">
                Imagens e PDFs até {question.maxFileSize || 10}MB
              </p>
            </div>
          </motion.button>
          {uploadError && (
            <div className="mt-3 flex items-center gap-2 text-sm" style={{ color: '#EF4444' }}>
              <AlertCircle className="w-4 h-4" />
              <span>{uploadError}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}



// ── CPF Question ──
interface CpfQuestionProps {
  question: QuestionConfig
  value: string
  onChange: (value: string) => void
  theme: ThemeConfig
  error?: string | null
}

function CpfQuestion({ question, value, onChange, theme, error }: CpfQuestionProps) {
  const [cpfError, setCpfError] = useState<string | null>(null)

  const handleChange = (raw: string) => {
    const formatted = formatCPF(raw)
    onChange(formatted)
    const clean = raw.replace(/\D/g, '')
    if (clean.length === 11) {
      setCpfError(validateCPF(clean) ? null : 'CPF inválido')
    } else {
      setCpfError(null)
    }
  }

  return (
    <div>
      <Input
        value={value || ''}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={question.placeholder || '000.000.000-00'}
        maxLength={14}
        className="text-lg md:text-xl h-auto py-3 bg-transparent border-0 border-b-2 rounded-none px-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        style={{
          borderColor: error || cpfError ? '#EF4444' : `${theme.textColor}50`,
          color: theme.textColor,
        }}
        autoFocus
      />
      {cpfError && <p className="text-xs mt-1" style={{ color: '#EF4444' }}>{cpfError}</p>}
    </div>
  )
}

interface AddressQuestionProps {
  question: QuestionConfig
  value: Record<string, string> | null
  onChange: (value: Record<string, string>) => void
  theme: ThemeConfig
  error?: string
}

function AddressQuestion({ question, value, onChange, theme, error }: AddressQuestionProps) {
  const [isLoadingCep, setIsLoadingCep] = useState(false)
  const [cepError, setCepError] = useState<string | null>(null)
  const addr = value || { cep: '', rua: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '' }

  const updateField = (field: string, val: string) => {
    const updated = { ...addr, [field]: val }
    onChange(updated)
  }

  const handleCepChange = async (cepValue: string) => {
    const clean = cepValue.replace(/\D/g, '').slice(0, 8)
    const formatted = clean.length > 5 ? `${clean.slice(0, 5)}-${clean.slice(5)}` : clean
    updateField('cep', formatted)
    setCepError(null)

    if (clean.length === 8) {
      setIsLoadingCep(true)
      try {
        const res = await fetch(`/api/cep/${clean}`)
        if (res.ok) {
          const data = await res.json()
          onChange({
            ...addr,
            cep: formatted,
            rua: data.street || data.rua || '',
            bairro: data.neighborhood || data.bairro || '',
            cidade: data.city || data.cidade || '',
            estado: data.state || data.estado || '',
          })
        } else {
          setCepError('CEP não encontrado')
        }
      } catch {
        setCepError('Erro ao buscar CEP')
      } finally {
        setIsLoadingCep(false)
      }
    }
  }

  const fieldStyle = {
    borderColor: `${theme.textColor}30`,
    color: theme.textColor,
    backgroundColor: 'transparent',
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="w-40">
          <label className="text-sm font-medium mb-1 block" style={{ color: theme.textColor }}>CEP</label>
          <div className="relative">
            <Input
              value={addr.cep}
              onChange={(e) => handleCepChange(e.target.value)}
              placeholder="00000-000"
              className="text-lg h-auto py-2 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
              style={fieldStyle}
              maxLength={9}
              autoFocus
            />
            {isLoadingCep && (
              <Loader2 className="w-4 h-4 animate-spin absolute right-3 top-1/2 -translate-y-1/2" style={{ color: theme.primaryColor }} />
            )}
          </div>
          {cepError && <p className="text-xs mt-1" style={{ color: '#EF4444' }}>{cepError}</p>}
        </div>
      </div>
      <div>
        <label className="text-sm font-medium mb-1 block" style={{ color: theme.textColor }}>Rua</label>
        <Input value={addr.rua} onChange={(e) => updateField('rua', e.target.value)} placeholder="Rua / Avenida" className="text-lg h-auto py-2 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0" style={fieldStyle} />
      </div>
      <div className="flex gap-3">
        <div className="w-32">
          <label className="text-sm font-medium mb-1 block" style={{ color: theme.textColor }}>Número</label>
          <Input value={addr.numero} onChange={(e) => updateField('numero', e.target.value)} placeholder="Nº" className="text-lg h-auto py-2 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0" style={fieldStyle} />
        </div>
        <div className="flex-1">
          <label className="text-sm font-medium mb-1 block" style={{ color: theme.textColor }}>Complemento</label>
          <Input value={addr.complemento} onChange={(e) => updateField('complemento', e.target.value)} placeholder="Apto, Sala..." className="text-lg h-auto py-2 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0" style={fieldStyle} />
        </div>
      </div>
      <div>
        <label className="text-sm font-medium mb-1 block" style={{ color: theme.textColor }}>Bairro</label>
        <Input value={addr.bairro} onChange={(e) => updateField('bairro', e.target.value)} placeholder="Bairro" className="text-lg h-auto py-2 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0" style={fieldStyle} />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-sm font-medium mb-1 block" style={{ color: theme.textColor }}>Cidade</label>
          <Input value={addr.cidade} onChange={(e) => updateField('cidade', e.target.value)} placeholder="Cidade" className="text-lg h-auto py-2 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0" style={fieldStyle} />
        </div>
        <div className="w-24">
          <label className="text-sm font-medium mb-1 block" style={{ color: theme.textColor }}>Estado</label>
          <Input value={addr.estado} onChange={(e) => updateField('estado', e.target.value)} placeholder="UF" className="text-lg h-auto py-2 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0" style={fieldStyle} maxLength={2} />
        </div>
      </div>
    </div>
  )
}


interface PhoneQuestionProps {
  question: QuestionConfig
  value: string
  onChange: (value: string) => void
  theme: ThemeConfig
  error?: string
}

function PhoneQuestion({ question, value, onChange, theme, error }: PhoneQuestionProps) {
  const defaultCode = question.defaultCountry || 'BR'
  const [selectedCountry, setSelectedCountry] = useState(() => getCountryByCode(defaultCode))
  const [phoneNumber, setPhoneNumber] = useState(() => {
    // Extract number part if value starts with dial code
    if (value) {
      const country = countries.find(c => value.startsWith(c.dial))
      if (country) {
        return value.slice(country.dial.length)
      }
    }
    return value || ''
  })
  const [isOpen, setIsOpen] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const dropdownRef = React.useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  React.useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  const handlePhoneChange = (num: string) => {
    const clean = num.replace(/[^\d]/g, '')
    setPhoneNumber(clean)
    onChange(clean ? selectedCountry.dial + clean : '')
  }

  const handleCountrySelect = (country: typeof selectedCountry) => {
    setSelectedCountry(country)
    setIsOpen(false)
    if (phoneNumber) {
      onChange(country.dial + phoneNumber)
    }
  }

  return (
    <div className="flex items-end gap-2">
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 text-xl md:text-2xl py-3 px-1 border-0 border-b-2 rounded-none bg-transparent whitespace-nowrap transition-colors"
          style={{
            borderColor: error ? '#EF4444' : isFocused ? theme.primaryColor : `${theme.textColor}30`,
            color: theme.textColor,
          }}
        >
          <span>{selectedCountry.flag}</span>
          <span className="text-lg md:text-xl">{selectedCountry.dial}</span>
          <span className="text-xs opacity-50">▾</span>
        </button>
        {isOpen && (
          <div
            className="absolute top-full left-0 mt-1 z-50 min-w-[220px] max-h-[280px] overflow-y-auto rounded-xl border shadow-lg"
            style={{ backgroundColor: theme.backgroundColor, borderColor: `${theme.textColor}20` }}
          >
            {countries.map((country) => (
              <button
                key={country.code}
                type="button"
                onClick={() => handleCountrySelect(country)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:opacity-80"
                style={{
                  color: theme.textColor,
                  backgroundColor: country.code === selectedCountry.code ? `${theme.primaryColor}15` : 'transparent',
                }}
              >
                <span className="text-lg">{country.flag}</span>
                <span className="text-sm flex-1">{country.name}</span>
                <span className="text-sm opacity-60">{country.dial}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <Input
        type="tel"
        value={phoneNumber}
        onChange={(e) => handlePhoneChange(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={selectedCountry.format}
        className="flex-1 text-xl md:text-2xl h-auto py-3 px-0 border-0 border-b-2 rounded-none bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:opacity-40"
        style={{
          borderColor: error ? '#EF4444' : isFocused ? theme.primaryColor : `${theme.textColor}30`,
          color: theme.textColor,
        }}
        autoFocus
      />
    </div>
  )
}

// ── Calendly Question ──
interface CalendlyQuestionProps {
  question: QuestionConfig
  value: string
  onChange: (value: string) => void
  theme: ThemeConfig
  onSubmit: (skipValidation?: boolean, valueOverride?: Json) => void
}

function CalendlyQuestion({ question, value, onChange, theme, onSubmit }: CalendlyQuestionProps) {
  const calendlyUrl = question.calendlyUrl
  const containerRef = React.useRef<HTMLDivElement>(null)
  const scriptLoadedRef = React.useRef(false)

  React.useEffect(() => {
    if (!calendlyUrl || scriptLoadedRef.current) return

    // Listen for Calendly events to capture scheduled event
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.event === 'calendly.event_scheduled') {
        const eventUri = e.data?.payload?.event?.uri || 'scheduled'
        onChange(eventUri)
      }
    }
    window.addEventListener('message', handleMessage)

    // Load Calendly widget script
    const existing = document.querySelector('script[src*="calendly.com/assets/external/widget.js"]')
    if (!existing) {
      const script = document.createElement('script')
      script.src = 'https://assets.calendly.com/assets/external/widget.js'
      script.async = true
      document.head.appendChild(script)
    }
    scriptLoadedRef.current = true

    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [calendlyUrl, onChange])

  if (!calendlyUrl) {
    return (
      <div className="p-6 rounded-xl border-2 border-dashed text-center" style={{ borderColor: `${theme.textColor}30`, color: theme.textColor }}>
        <p className="text-sm opacity-60">URL do Calendly não configurada</p>
      </div>
    )
  }

  if (value) {
    return (
      <div className="p-6 rounded-xl border-2 text-center" style={{ borderColor: theme.primaryColor, color: theme.textColor }}>
        <Check className="w-10 h-10 mx-auto mb-3" style={{ color: theme.primaryColor }} />
        <p className="text-lg font-medium">Agendamento confirmado!</p>
        <p className="text-sm opacity-60 mt-1">Seu horário foi reservado com sucesso.</p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="rounded-xl overflow-hidden border" style={{ borderColor: `${theme.textColor}20` }}>
      <div
        className="calendly-inline-widget"
        data-url={calendlyUrl}
        style={{ minWidth: '280px', height: '630px' }}
      />
    </div>
  )
}

interface QuestionRendererProps {
  question: QuestionConfig
  value: Json
  onChange: (value: Json) => void
  theme: ThemeConfig
  error?: string
  onSubmit: (skipValidation?: boolean, valueOverride?: Json) => void
  onClearError?: () => void
}

export function QuestionRenderer({ 
  question, 
  value, 
  onChange, 
  theme,
  error,
  onSubmit,
  onClearError
}: QuestionRendererProps) {
  const [isFocused, setIsFocused] = useState(false)

  // B15: Atalhos de teclado para opções de resposta
  React.useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Ignorar se estiver digitando em um input/textarea
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      const key = e.key.toUpperCase()

      // Sim/Não: S / N
      if (question.type === 'yes_no') {
        if (key === 'S') {
          e.preventDefault()
          onChange('Sim')
          onClearError?.()
          onSubmit(true, 'Sim')
        } else if (key === 'N') {
          e.preventDefault()
          onChange('Não')
          onClearError?.()
          onSubmit(true, 'Não')
        }
      }

      // Dropdown (single-select): A, B, C, D...
      if (question.type === 'dropdown' && question.options) {
        const idx = key.charCodeAt(0) - 65 // A=0, B=1, ...
        if (idx >= 0 && idx < question.options.length) {
          e.preventDefault()
          const selectedOption = question.options[idx]
          onChange(selectedOption)
          onClearError?.()
          onSubmit(true, selectedOption)
        }
      }

      // Checkboxes (multi-select): A, B, C, D... toggle
      if (question.type === 'checkboxes' && question.options) {
        const idx = key.charCodeAt(0) - 65
        if (idx >= 0 && idx < question.options.length) {
          e.preventDefault()
          const selected = Array.isArray(value) ? (value as string[]) : []
          const option = question.options[idx]
          const newValues = selected.includes(option)
            ? selected.filter(v => v !== option)
            : [...selected, option]
          onChange(newValues)
        }
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [question, value, onChange, onSubmit, onClearError])

  const inputStyles = {
    borderColor: error ? '#EF4444' : isFocused ? theme.primaryColor : `${theme.textColor}30`,
    color: theme.textColor,
    backgroundColor: 'transparent',
  }

  switch (question.type) {
    case 'phone':
      return (
        <PhoneQuestion
          question={question}
          value={String(value || '')}
          onChange={(v) => onChange(v)}
          theme={theme}
          error={error}
        />
      )

    case 'short_text':
    case 'email':
    case 'url':
    case 'number':
      return (
        <Input
          type={question.type === 'number' ? 'number' : question.type === 'email' ? 'email' : 'text'}
          value={String(value || '')}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={question.placeholder || 'Digite sua resposta aqui...'}
          className="text-xl md:text-2xl h-auto py-3 px-0 border-0 border-b-2 rounded-none bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:opacity-40"
          style={inputStyles}
          autoFocus
        />
      )

    case 'long_text':
      return (
        <Textarea
          value={String(value || '')}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={question.placeholder || 'Digite sua resposta aqui...'}
          className="text-lg md:text-xl min-h-[150px] p-4 border-2 rounded-xl bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:opacity-40 resize-none"
          style={inputStyles}
          autoFocus
        />
      )

    case 'date':
      return (
        <Input
          type="date"
          value={String(value || '')}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          className="text-xl md:text-2xl h-auto py-3 px-0 border-0 border-b-2 rounded-none bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
          style={inputStyles}
          autoFocus
        />
      )

    case 'dropdown':
      return (
        <div className="space-y-3">
          {(question.options || []).map((option, index) => {
            const isSelected = value === option
            const shortcutKey = String.fromCharCode(65 + index)
            return (
              <motion.button
                key={index}
                type="button"
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onChange(option)
                  onClearError?.()
                  onSubmit(true, option)
                }}
                className="w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all relative"
                style={{
                  borderColor: isSelected ? theme.primaryColor : `${theme.textColor}20`,
                  backgroundColor: isSelected ? `${theme.primaryColor}10` : 'transparent',
                  color: theme.textColor,
                }}
              >
                <div 
                  className="w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors"
                  style={{ 
                    borderColor: isSelected ? theme.primaryColor : `${theme.textColor}40`,
                    backgroundColor: isSelected ? theme.primaryColor : 'transparent',
                  }}
                >
                  {isSelected ? (
                    <Check className="w-4 h-4" style={{ color: theme.backgroundColor }} />
                  ) : (
                    <span className="text-sm font-medium" style={{ color: theme.textColor }}>
                      {shortcutKey}
                    </span>
                  )}
                </div>
                <span className="text-lg flex-1">{option}</span>
                {/* B15: Atalho de teclado */}
                <kbd
                  className="hidden sm:inline-flex items-center justify-center w-6 h-6 rounded text-[10px] font-mono font-bold opacity-40"
                  style={{ backgroundColor: `${theme.textColor}10`, color: theme.textColor }}
                >
                  {shortcutKey}
                </kbd>
              </motion.button>
            )
          })}
        </div>
      )

    case 'checkboxes':
      const selectedValues = Array.isArray(value) ? value : []
      return (
        <div className="space-y-3">
          {(question.options || []).map((option, index) => {
            const isSelected = selectedValues.includes(option)
            const shortcutKey = String.fromCharCode(65 + index)
            return (
              <motion.button
                key={index}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={() => {
                  const newValues = isSelected
                    ? selectedValues.filter(v => v !== option)
                    : [...selectedValues, option]
                  onChange(newValues)
                }}
                className="w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all relative"
                style={{
                  borderColor: isSelected ? theme.primaryColor : `${theme.textColor}20`,
                  backgroundColor: isSelected ? `${theme.primaryColor}10` : 'transparent',
                  color: theme.textColor,
                }}
              >
                <div 
                  className="w-8 h-8 rounded-lg border-2 flex items-center justify-center shrink-0 transition-colors"
                  style={{ 
                    borderColor: isSelected ? theme.primaryColor : `${theme.textColor}40`,
                    backgroundColor: isSelected ? theme.primaryColor : 'transparent',
                  }}
                >
                  {isSelected ? (
                    <Check className="w-4 h-4" style={{ color: theme.backgroundColor }} />
                  ) : (
                    <span className="text-sm font-medium" style={{ color: theme.textColor }}>
                      {shortcutKey}
                    </span>
                  )}
                </div>
                <span className="text-lg flex-1">{option}</span>
                {/* B15: Atalho de teclado */}
                <kbd
                  className="hidden sm:inline-flex items-center justify-center w-6 h-6 rounded text-[10px] font-mono font-bold opacity-40"
                  style={{ backgroundColor: `${theme.textColor}10`, color: theme.textColor }}
                >
                  {shortcutKey}
                </kbd>
              </motion.button>
            )
          })}
          <p className="text-sm opacity-50 mt-2" style={{ color: theme.textColor }}>
            Selecione todas que se aplicam
          </p>
        </div>
      )

    case 'yes_no':
      return (
        <div className="flex gap-4">
          {['Sim', 'Não'].map((option) => {
            const isSelected = value === option
            const shortcutKey = option === 'Sim' ? 'S' : 'N'
            return (
              <motion.button
                key={option}
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onChange(option)
                  onClearError?.()
                  onSubmit(true, option)
                }}
                className="flex-1 flex items-center justify-center gap-3 p-5 rounded-xl border-2 transition-all relative"
                style={{
                  borderColor: isSelected ? theme.primaryColor : `${theme.textColor}20`,
                  backgroundColor: isSelected ? `${theme.primaryColor}10` : 'transparent',
                  color: theme.textColor,
                }}
              >
                <div 
                  className="w-8 h-8 rounded-lg border-2 flex items-center justify-center shrink-0 transition-colors"
                  style={{ 
                    borderColor: isSelected ? theme.primaryColor : `${theme.textColor}40`,
                    backgroundColor: isSelected ? theme.primaryColor : 'transparent',
                  }}
                >
                  {isSelected ? (
                    <Check className="w-4 h-4" style={{ color: theme.backgroundColor }} />
                  ) : (
                    <span className="text-sm font-medium" style={{ color: theme.textColor }}>
                      {shortcutKey}
                    </span>
                  )}
                </div>
                <span className="text-xl font-medium">{option}</span>
                {/* B15: Atalho de teclado visível */}
                <kbd
                  className="absolute top-2 right-2 hidden sm:inline-flex items-center justify-center w-6 h-6 rounded text-[10px] font-mono font-bold opacity-40"
                  style={{ backgroundColor: `${theme.textColor}10`, color: theme.textColor }}
                >
                  {shortcutKey}
                </kbd>
              </motion.button>
            )
          })}
        </div>
      )

    case 'rating':
      const maxRating = question.maxValue || 5
      const currentRating = typeof value === 'number' ? value : 0
      return (
        <div className="flex gap-2">
          {Array.from({ length: maxRating }).map((_, index) => {
            const starValue = index + 1
            const isActive = starValue <= currentRating
            return (
              <motion.button
                key={index}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => onChange(starValue)}
                className="p-1"
              >
                <Star
                  className="w-10 h-10 md:w-12 md:h-12 transition-colors"
                  fill={isActive ? theme.primaryColor : 'transparent'}
                  style={{ 
                    color: isActive ? theme.primaryColor : `${theme.textColor}30`,
                  }}
                />
              </motion.button>
            )
          })}
        </div>
      )

    case 'opinion_scale':
      const minScale = question.minValue || 1
      const maxScale = question.maxValue || 10
      const scaleValue = typeof value === 'number' ? value : null
      return (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: maxScale - minScale + 1 }).map((_, index) => {
            const num = minScale + index
            const isSelected = scaleValue === num
            return (
              <motion.button
                key={num}
                type="button"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onChange(num)
                  onClearError?.()
                  onSubmit(true, num)
                }}
                className="w-12 h-12 md:w-14 md:h-14 rounded-xl border-2 flex items-center justify-center text-lg font-medium transition-all"
                style={{
                  borderColor: isSelected ? theme.primaryColor : `${theme.textColor}30`,
                  backgroundColor: isSelected ? theme.primaryColor : 'transparent',
                  color: isSelected ? theme.backgroundColor : theme.textColor,
                }}
              >
                {num}
              </motion.button>
            )
          })}
        </div>
      )

    case 'nps':
      const npsValue = typeof value === 'number' ? value : null
      return (
        <div>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 11 }).map((_, index) => {
              const isSelected = npsValue === index
              let borderHint = `${theme.textColor}30`
              if (!isSelected) {
                if (index <= 6) borderHint = `${theme.textColor}20`
                else if (index <= 8) borderHint = `${theme.textColor}25`
                else borderHint = `${theme.textColor}30`
              }
              return (
                <motion.button
                  key={index}
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onChange(index)
                    onClearError?.()
                    onSubmit(true, index)
                  }}
                  className="w-12 h-12 md:w-14 md:h-14 rounded-xl border-2 flex items-center justify-center text-lg font-medium transition-all"
                  style={{
                    borderColor: isSelected ? theme.primaryColor : borderHint,
                    backgroundColor: isSelected ? theme.primaryColor : 'transparent',
                    color: isSelected ? theme.backgroundColor : theme.textColor,
                  }}
                >
                  {index}
                </motion.button>
              )
            })}
          </div>
          <div className="flex justify-between mt-3 text-sm opacity-50" style={{ color: theme.textColor }}>
            <span>Nada provável</span>
            <span>Muito provável</span>
          </div>
        </div>
      )

    case 'file_upload':
      return (
        <FileUploadQuestion
          question={question}
          value={value as FileUploadValue | null}
          onChange={(v) => onChange(v as Json)}
          theme={theme}
        />
      )

    case 'cpf':
      return (
        <CpfQuestion
          question={question}
          value={value as string}
          onChange={(v) => onChange(v as Json)}
          theme={theme}
          error={error}
        />
      )

    case 'address':
      return (
        <AddressQuestion
          question={question}
          value={value as Record<string, string> | null}
          onChange={(v) => onChange(v as Json)}
          theme={theme}
          error={error}
        />
      )

    case 'calendly':
      return (
        <CalendlyQuestion
          question={question}
          value={value as string}
          onChange={(v) => onChange(v as Json)}
          theme={theme}
          onSubmit={onSubmit}
        />
      )

    case 'content_block': {
      return (
        <div className="space-y-5">
          {question.contentBody && (
            <div
              style={{ color: theme.textColor }}
              className="content-block-body text-base md:text-lg leading-relaxed [&>p]:mb-4 [&>p:last-child]:mb-0 [&>ul]:mb-4 [&>ul:last-child]:mb-0 [&>ul]:list-disc [&>ul]:pl-5 [&_strong]:font-semibold [&_em]:italic"
              dangerouslySetInnerHTML={{ __html: renderContentBlockHtml(question.contentBody) }}
            />
          )}
          {question.contentButtonText ? (
            question.contentButtonUrl ? (
              <a
                href={question.contentButtonUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-base font-medium transition-opacity hover:opacity-80"
                style={{
                  backgroundColor: theme.primaryColor,
                  color: theme.backgroundColor,
                }}
                onClick={() => { onChange('viewed'); onSubmit(true, 'viewed') }}
              >
                {question.contentButtonText}
                <ExternalLink className="w-4 h-4" />
              </a>
            ) : (
              <button
                type="button"
                onClick={() => { onChange('viewed'); onSubmit(true, 'viewed') }}
                className="inline-flex items-center justify-center px-6 py-3 rounded-xl text-base font-medium transition-opacity hover:opacity-80"
                style={{
                  backgroundColor: theme.primaryColor,
                  color: theme.backgroundColor,
                }}
              >
                {question.contentButtonText}
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={() => { onChange('viewed'); onSubmit(true, 'viewed') }}
              className="inline-flex items-center justify-center px-6 py-3 rounded-xl text-base font-medium transition-opacity hover:opacity-80"
              style={{
                backgroundColor: theme.primaryColor,
                color: theme.backgroundColor,
              }}
            >
              Continuar
            </button>
          )}
        </div>
      )
    }

    default:
      return (
        <p style={{ color: theme.textColor }} className="opacity-50">
          Tipo de pergunta não suportado: {question.type}
        </p>
      )
  }
}

