'use client'

import { useState, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { MessageCircle, Loader2, Send, AlertCircle } from 'lucide-react'
import { FormWhatsAppSettings } from '@/lib/types/whatsapp'
import { PLAN_ORDER } from '@/lib/plans'

interface WhatsAppPanelProps {
  formId: string
  settings: FormWhatsAppSettings | null
  questions?: Array<{ id: string; title: string }>
  userPlan?: string
  onUpdateForm?: (updates: Record<string, unknown>) => void
  isLoading?: boolean
}

const WHATSAPP_GREEN = '#25D366'

// Check if plan is Plus+ or higher
function isPlusPlan(plan: string | null | undefined): boolean {
  const normalizedPlan = (plan?.trim().toLowerCase() ?? 'free') as typeof PLAN_ORDER[number]
  return PLAN_ORDER.indexOf(normalizedPlan as typeof PLAN_ORDER[number]) >= PLAN_ORDER.indexOf('plus')
}

// Phone validation (digits only, 10-15 chars)
function validatePhoneNumber(phone: string): boolean {
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 15
}

// Available fixed template variables
const FIXED_TEMPLATE_VARIABLES = [
  { key: '{form_name}', description: 'Nome do formulário' },
  { key: '{nome}', description: 'Campo "nome" da resposta (fallback: "Lead")' },
  { key: '{email}', description: 'Campo "email" da resposta (fallback: "N/A")' },
  { key: '{telefone}', description: 'Campo "telefone" da resposta (fallback: "")' },
  { key: '{response_id}', description: 'ID da resposta' },
  { key: '{response_link}', description: 'Link para ver a resposta' },
  { key: '{meta_events}', description: 'Eventos do Meta Pixel disparados pelo lead' },
]

const DEFAULT_MESSAGE_TEMPLATE = 'Nova resposta em {form_name}: {nome}'

function normalizeSettingsSnapshot(
  settings: Pick<FormWhatsAppSettings, 'enabled' | 'owner_phone' | 'message_template'>
) {
  return JSON.stringify({
    enabled: settings.enabled ?? false,
    owner_phone: settings.owner_phone ?? '',
    message_template: settings.message_template ?? DEFAULT_MESSAGE_TEMPLATE,
  })
}

export function WhatsAppPanel({
  formId,
  settings: initialSettings,
  questions = [],
  userPlan = 'free',
  isLoading = false,
}: WhatsAppPanelProps) {
  const [enabled, setEnabled] = useState(initialSettings?.enabled ?? false)
  const [ownerPhone, setOwnerPhone] = useState(initialSettings?.owner_phone ?? '')
  const [messageTemplate, setMessageTemplate] = useState(
    initialSettings?.message_template ?? DEFAULT_MESSAGE_TEMPLATE
  )
  const [isTestingMessage, setIsTestingMessage] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoadingSettings, setIsLoadingSettings] = useState(true)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [settingsInitialized, setSettingsInitialized] = useState(false)
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null)

  const isPlusUser = isPlusPlan(userPlan)

  // Load settings from unified endpoint on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        setIsLoadingSettings(true)
        const response = await fetch(`/api/forms/${formId}/whatsapp`)
        if (response.ok) {
          const data = await response.json()
          const s = data.settings
          if (s) {
            setEnabled(s.enabled ?? false)
            setOwnerPhone(s.owner_phone ?? '')
            setMessageTemplate(s.message_template ?? DEFAULT_MESSAGE_TEMPLATE)
            setInitialSnapshot(
              normalizeSettingsSnapshot({
                enabled: s.enabled ?? false,
                owner_phone: s.owner_phone ?? '',
                message_template: s.message_template ?? DEFAULT_MESSAGE_TEMPLATE,
              })
            )
          } else {
            setInitialSnapshot(
              normalizeSettingsSnapshot({
                enabled: false,
                owner_phone: '',
                message_template: DEFAULT_MESSAGE_TEMPLATE,
              })
            )
          }
        }
      } catch (error) {
        console.error('Error loading WhatsApp settings:', error)
      } finally {
        setIsLoadingSettings(false)
        setSettingsInitialized(true)
      }
    }
    loadSettings()
  }, [formId])

  // Auto-save on change (debounce 3s) — only after initial load, silent on success
  useEffect(() => {
    if (!settingsInitialized || !initialSnapshot) return

    const currentSnapshot = normalizeSettingsSnapshot({
      enabled,
      owner_phone: ownerPhone,
      message_template: messageTemplate,
    })

    if (currentSnapshot === initialSnapshot) return

    const timer = setTimeout(() => {
      const saveSettings = async () => {
        try {
          setIsSaving(true)

          // Validate phone if enabled
          if (enabled && ownerPhone && !validatePhoneNumber(ownerPhone)) {
            setPhoneError('Número muito curto. Inclua o código do país (55) e o DDD.')
            return
          }

          setPhoneError(null)

          // Upsert via unified endpoint
          const response = await fetch(`/api/forms/${formId}/whatsapp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              enabled,
              owner_phone: ownerPhone,
              message_template: messageTemplate,
            }),
          })

          if (!response.ok) {
            const error = await response.json()
            toast.error(`Erro ao salvar: ${error.error || 'Erro desconhecido'}`)
            return
          }

          // Silent success — no toast on auto-save to avoid interrupting typing
        } catch (error) {
          console.error('Error saving WhatsApp settings:', error)
          toast.error('Erro ao salvar configurações de WhatsApp')
        } finally {
          setIsSaving(false)
        }
      }

      saveSettings()
    }, 3000) // 3 second debounce — gives user time to type without interruption

    return () => clearTimeout(timer)
  }, [enabled, ownerPhone, messageTemplate, formId, settingsInitialized, initialSnapshot])

  const handleToggle = useCallback((checked: boolean) => {
    setEnabled(checked)
    if (!checked) {
      setPhoneError(null)
    }
  }, [])

  const handleTestMessage = async () => {
    if (!validated) {
      toast.error('Preencha todos os campos obrigatórios')
      return
    }

    try {
      setIsTestingMessage(true)
      
      const response = await fetch(`/api/form/${formId}/whatsapp/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_phone: ownerPhone,
          message_template: messageTemplate,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        toast.error(`Erro ao enviar teste: ${error.error || 'Erro desconhecido'}`)
        return
      }

      toast.success('✅ Mensagem de teste enviada!')
    } catch (error) {
      console.error('Error sending test message:', error)
      toast.error('Erro ao enviar mensagem de teste')
    } finally {
      setIsTestingMessage(false)
    }
  }

  const validated = enabled && ownerPhone && validatePhoneNumber(ownerPhone)
  const charCount = messageTemplate.length
  const isCharCountWarning = charCount > 160

  const dynamicQuestionVariables = questions
    .map((question) => question?.title?.trim())
    .filter((title): title is string => Boolean(title))
    .map((title) => {
      const normalized = title
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
      return normalized
    })
    .filter(Boolean)

  const fixedVariableNames = new Set(['nome', 'email', 'telefone'])

  const uniqueDynamicQuestionVariables = Array.from(
    new Set(dynamicQuestionVariables.filter((key) => !fixedVariableNames.has(key)))
  ).map((key) => ({
    key: `{${key}}`,
    description: `Campo "${key}" da resposta`,
  }))

  const templateVariables = [...FIXED_TEMPLATE_VARIABLES, ...uniqueDynamicQuestionVariables]

  // Show loading while fetching settings
  if (isLoadingSettings) {
    return (
      <div className="h-full w-full flex flex-col">
        <div className="shrink-0 px-4 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4" style={{ color: WHATSAPP_GREEN }} />
            <span className="text-sm font-medium text-slate-700">WhatsApp Notifications</span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        </div>
      </div>
    )
  }

  // If not Plus+ plan, show upgrade message
  if (!isPlusUser) {
    return (
      <div className="h-full w-full flex flex-col">
        <div className="shrink-0 px-4 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4" style={{ color: WHATSAPP_GREEN }} />
            <span className="text-sm font-medium text-slate-700">WhatsApp Notifications</span>
            <Badge variant="secondary" className="ml-auto text-[10px]">Plus+ Only</Badge>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">
          <AlertCircle className="w-8 h-8 text-amber-500 mb-3" />
          <p className="text-sm font-medium text-slate-700 text-center mb-1">
            Recurso exclusivo para Plus+
          </p>
          <p className="text-xs text-slate-500 text-center">
            Faça upgrade do seu plano para ativar notificações via WhatsApp
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full w-full max-w-full overflow-x-hidden flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-slate-100 bg-green-50/50">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4" style={{ color: WHATSAPP_GREEN }} />
          <span className="text-sm font-medium text-slate-700">WhatsApp Notifications</span>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 max-w-full overflow-x-hidden">
        <div className="p-4 space-y-5 max-w-full overflow-hidden">
          {/* Enable Toggle */}
          <div className="flex items-center justify-between gap-3 py-1 max-w-full">
            <div>
              <Label className="text-xs font-medium text-slate-700">
                Ativar Notificações WhatsApp
              </Label>
              <p className="text-[10px] text-slate-500">
                Enviar notificação quando formulário for respondido
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={handleToggle}
              disabled={isLoading || isSaving}
              aria-label="Ativar WhatsApp Notifications"
            />
          </div>

          {enabled && (
            <>
              <Separator className="my-2" />

              {/* Owner WhatsApp Number */}
              <div>
                <Label htmlFor="whatsapp-phone" className="text-xs font-medium text-slate-600 mb-1.5 block">
                  Número de WhatsApp do Proprietário
                  <span className="text-red-500 ml-1">*</span>
                </Label>
                <Input
                  id="whatsapp-phone"
                  type="tel"
                  value={ownerPhone}
                  onChange={(e) => {
                    // Aceita apenas dígitos
                    const digits = e.target.value.replace(/\D/g, '')
                    setOwnerPhone(digits)
                    if (digits && digits.length >= 10) {
                      setPhoneError(null)
                    } else if (digits) {
                      setPhoneError('Número muito curto. Inclua o código do país (55) e o DDD.')
                    } else {
                      setPhoneError(null)
                    }
                  }}
                  disabled={isLoading || isSaving}
                  placeholder="5511999999999"
                  maxLength={15}
                  className={`text-sm ${phoneError ? 'border-red-500 focus:border-red-500' : ''}`}
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Digite com código do país e DDD, sem espaços ou traços. Ex: 5511999999999
                </p>
                {phoneError && (
                  <p className="text-[10px] text-red-500 mt-1">{phoneError}</p>
                )}
              </div>

              {/* Message Template */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <Label htmlFor="whatsapp-template" className="text-xs font-medium text-slate-600">
                    Template da Mensagem
                  </Label>
                  <span className={`text-[10px] font-medium ${isCharCountWarning ? 'text-amber-600' : 'text-slate-500'}`}>
                    {charCount}/160
                  </span>
                </div>
                <Textarea
                  id="whatsapp-template"
                  value={messageTemplate}
                  onChange={(e) => setMessageTemplate(e.target.value)}
                  disabled={isLoading || isSaving}
                  placeholder={DEFAULT_MESSAGE_TEMPLATE}
                  className="text-sm min-h-[80px]"
                />
                <p className="text-[10px] text-slate-500 mt-2">
                  Variáveis disponíveis:
                </p>
                <div className="mt-2 space-y-1">
                  {templateVariables.map((variable) => (
                    <div key={variable.key} className="flex items-start gap-2">
                      <code className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-700 font-mono whitespace-nowrap">
                        {variable.key}
                      </code>
                      <span className="text-[10px] text-slate-500">{variable.description}</span>
                    </div>
                  ))}
                </div>
                {isCharCountWarning && (
                  <p className="text-[10px] text-amber-600 mt-2">
                    ⚠️ Mensagens com mais de 160 caracteres podem ser divididas em SMS múltiplos
                  </p>
                )}
              </div>

              {/* WhatsApp Instance Dropdown (hidden for now) */}
              {/*
              <div>
                <Label htmlFor="whatsapp-instance" className="text-xs font-medium text-slate-600 mb-1.5 block">
                  Instância WhatsApp
                </Label>
                <Select value={instance} onValueChange={setInstance} disabled={isLoading || isSaving}>
                  <SelectTrigger id="whatsapp-instance" className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {whatsAppInstances.map((inst) => (
                      <SelectItem key={inst} value={inst}>
                        {inst === 'default' ? 'Padrão' : inst}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-slate-500 mt-1">
                  Qual número WhatsApp vai enviar as notificações
                </p>
              </div>
              */}

              {/* Rate Limit (hidden for now) */}
              {/*
              <div>
                <Label htmlFor="whatsapp-rate-limit" className="text-xs font-medium text-slate-600 mb-1.5 block">
                  Limite de Notificações (msgs/hora)
                </Label>
                <Input
                  id="whatsapp-rate-limit"
                  type="number"
                  min="1"
                  max="1000"
                  value={rateLimit}
                  onChange={(e) => setRateLimit(Math.max(1, Math.min(1000, parseInt(e.target.value) || 100)))}
                  disabled={isLoading || isSaving}
                  className="text-sm"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Máximo de notificações que serão enviadas por hora
                </p>
              </div>
              */}

              {/* Test Message Button */}
              <div className="pt-2">
                <Button
                  onClick={handleTestMessage}
                  disabled={!validated || isTestingMessage || isSaving}
                  className="w-full bg-green-600 hover:bg-green-700"
                  size="sm"
                >
                  {isTestingMessage ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Enviar Mensagem de Teste
                    </>
                  )}
                </Button>
              </div>
            </>
          )}

          {isSaving && (
            <div className="text-center py-2">
              <p className="text-[10px] text-slate-500 flex items-center justify-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                Salvando configurações...
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
