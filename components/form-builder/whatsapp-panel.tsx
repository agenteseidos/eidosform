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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { MessageCircle, Loader2, Send, AlertCircle } from 'lucide-react'
import { FormWhatsAppSettings } from '@/lib/types/whatsapp'
import { PLAN_ORDER } from '@/lib/plans'

interface WhatsAppPanelProps {
  formId: string
  settings: FormWhatsAppSettings | null
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

// Phone validation (BR format: +55...)
function validatePhoneNumber(phone: string): boolean {
  const phoneRegex = /^\+55\s?\d{2}\s?\d{4,5}-?\d{4}$/
  return phoneRegex.test(phone.trim())
}

// Available template variables
const TEMPLATE_VARIABLES = [
  { key: '{form_name}', description: 'Nome do formulário' },
  { key: '{nome}', description: 'Campo "nome" da resposta (fallback: "Lead")' },
  { key: '{email}', description: 'Campo "email" da resposta (fallback: "N/A")' },
  { key: '{response_id}', description: 'ID da resposta' },
  { key: '{response_link}', description: 'Link para ver a resposta' },
]

const DEFAULT_MESSAGE_TEMPLATE = 'Nova resposta em {form_name}: {nome}'

export function WhatsAppPanel({
  formId,
  settings,
  userPlan = 'free',
  onUpdateForm,
  isLoading = false,
}: WhatsAppPanelProps) {
  const [enabled, setEnabled] = useState(settings?.enabled ?? false)
  const [ownerPhone, setOwnerPhone] = useState(settings?.owner_phone ?? '')
  const [messageTemplate, setMessageTemplate] = useState(
    settings?.message_template ?? DEFAULT_MESSAGE_TEMPLATE
  )
  const [instance, setInstance] = useState(settings?.instance_name ?? 'default')
  const [rateLimit, setRateLimit] = useState(settings?.rate_limit_per_hour ?? 100)
  const [isTestingMessage, setIsTestingMessage] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [whatsAppInstances] = useState<string[]>(['default', 'instancia-2', 'instancia-3'])
  const [phoneError, setPhoneError] = useState<string | null>(null)

  const isPlusUser = isPlusPlan(userPlan)

  // Auto-save on change (debounce)
  useEffect(() => {
    if (!onUpdateForm) return
    
    const timer = setTimeout(() => {
      if (!enabled) return
      
      const saveSettings = async () => {
        try {
          setIsSaving(true)
          
          // Validate phone if enabled
          if (enabled && !validatePhoneNumber(ownerPhone)) {
            setPhoneError('Número de WhatsApp inválido. Use formato: +55 11 98765-4321')
            return
          }
          
          setPhoneError(null)
          
          const response = await fetch(`/api/form/${formId}/whatsapp/settings`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              enabled,
              owner_phone: ownerPhone,
              message_template: messageTemplate,
              instance_name: instance,
              rate_limit_per_hour: rateLimit,
            }),
          })

          if (!response.ok) {
            const error = await response.json()
            toast.error(`Erro ao salvar: ${error.error || 'Erro desconhecido'}`)
            return
          }

          toast.success('Configuração salva com sucesso!')
        } catch (error) {
          console.error('Error saving WhatsApp settings:', error)
          toast.error('Erro ao salvar configurações de WhatsApp')
        } finally {
          setIsSaving(false)
        }
      }

      saveSettings()
    }, 1000) // 1 second debounce

    return () => clearTimeout(timer)
  }, [enabled, ownerPhone, messageTemplate, instance, rateLimit, formId, onUpdateForm])

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
          instance_name: instance,
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
                    setOwnerPhone(e.target.value)
                    if (e.target.value && !validatePhoneNumber(e.target.value)) {
                      setPhoneError('Formato inválido')
                    } else {
                      setPhoneError(null)
                    }
                  }}
                  onBlur={() => {
                    if (ownerPhone && !validatePhoneNumber(ownerPhone)) {
                      setPhoneError('Número de WhatsApp inválido. Use formato: +55 11 98765-4321')
                    }
                  }}
                  disabled={isLoading || isSaving}
                  placeholder="+55 11 98765-4321"
                  className={`text-sm ${phoneError ? 'border-red-500 focus:border-red-500' : ''}`}
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Número que receberá as notificações (formato BR: +55)
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
                  {TEMPLATE_VARIABLES.map((variable) => (
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

              {/* WhatsApp Instance Dropdown */}
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

              {/* Rate Limit */}
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
