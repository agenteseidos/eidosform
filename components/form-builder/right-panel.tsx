'use client'

import { useState, useRef } from 'react'
import { QuestionConfig, QuestionType, Form } from '@/lib/database.types'
import { questionTypes, getQuestionTypeInfo } from '@/lib/questions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import {
  Check,
  Copy,
  HandMetal,
  Loader2,
  MousePointerClick,
  PartyPopper,
  Settings2,
  Trash2,
  Upload,
  Zap,
} from 'lucide-react'
import { QuestionEditor } from './question-editor'

interface RightPanelProps {
  selectedQuestion: QuestionConfig | null
  allQuestions: QuestionConfig[]
  onUpdateQuestion: (id: string, updates: Partial<QuestionConfig>) => void
  onDeleteQuestion: (id: string) => void
  onDuplicateQuestion: (id: string) => void
  ownerPlan?: string
  sidebarSection?: 'welcome' | 'questions' | 'thankyou' | null
  form?: Form | null
  onUpdateForm?: (updates: Partial<Form>) => void
  onWelcomeImageUpload?: (file: File) => void
  onRemoveWelcomeImage?: () => void
  isUploadingImage?: boolean
}

export function RightPanel({
  selectedQuestion,
  allQuestions,
  onUpdateQuestion,
  onDeleteQuestion,
  onDuplicateQuestion,
  ownerPlan = 'free',
  sidebarSection,
  form,
  onUpdateForm,
  onWelcomeImageUpload,
  onRemoveWelcomeImage,
  isUploadingImage,
}: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<'question' | 'logic'>('question')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // B08: Welcome screen editor
  if (sidebarSection === 'welcome' && form && onUpdateForm) {
    return (
      <div className="h-full max-w-full overflow-hidden flex flex-col">
        <div className="shrink-0 px-4 py-3 border-b border-slate-100 bg-amber-50/50">
          <div className="flex items-center gap-2">
            <HandMetal className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-medium text-slate-700">Tela de Boas Vindas</span>
          </div>
        </div>
        <ScrollArea className="flex-1 max-w-full">
          <div className="p-4 space-y-5 max-w-full overflow-hidden">
            <div className="flex items-center justify-between gap-3 py-1 max-w-full">
              <div>
                <Label className="text-xs font-medium text-slate-700">Ativar tela de boas vindas</Label>
                <p className="text-[10px] text-slate-400">Mostrar antes das perguntas</p>
              </div>
              <Switch
                checked={form.welcome_enabled || false}
                onCheckedChange={(checked) => onUpdateForm({ welcome_enabled: checked })}
              />
            </div>
            {form.welcome_enabled && (
              <>
                <div>
                  <Label className="text-xs font-medium text-slate-600 mb-1.5 block">Título</Label>
                  <Input
                    value={form.welcome_title || ''}
                    onChange={(e) => onUpdateForm({ welcome_title: e.target.value || null })}
                    className="text-sm"
                    placeholder={form.title || 'Bem-vindo!'}
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium text-slate-600 mb-1.5 block">Descrição</Label>
                  <Textarea
                    value={form.welcome_description || ''}
                    onChange={(e) => onUpdateForm({ welcome_description: e.target.value || null })}
                    className="text-sm"
                    placeholder="Uma breve descrição do formulário..."
                    rows={3}
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium text-slate-600 mb-1.5 block">Imagem</Label>
                  {form.welcome_image_url ? (
                    <div className="space-y-2">
                      <div className="relative rounded-lg overflow-hidden border border-slate-200">
                        <img src={form.welcome_image_url} alt="Welcome" className="w-full h-28 object-contain bg-slate-50" />
                      </div>
                      <Button variant="outline" size="sm" onClick={onRemoveWelcomeImage} className="text-red-600 hover:text-red-700 hover:bg-red-50">
                        <Trash2 className="w-3 h-3 mr-1" /> Remover
                      </Button>
                    </div>
                  ) : (
                    <div
                      className="border-2 border-dashed border-slate-300 rounded-lg p-4 text-center cursor-pointer hover:border-slate-400 hover:bg-slate-50 transition-colors"
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
                      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const file = e.dataTransfer.files?.[0]; if (file && onWelcomeImageUpload) onWelcomeImageUpload(file) }}
                    >
                      {isUploadingImage ? (
                        <div className="flex flex-col items-center gap-1">
                          <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
                          <span className="text-xs text-slate-500">Enviando...</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1">
                          <Upload className="w-5 h-5 text-slate-400" />
                          <span className="text-xs text-slate-500">Clique ou arraste</span>
                          <span className="text-[10px] text-slate-400">SVG, PNG, JPG, GIF (até 2MB)</span>
                        </div>
                      )}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".svg,.png,.jpg,.jpeg,.gif"
                        className="hidden"
                        onChange={(e) => { const file = e.target.files?.[0]; if (file && onWelcomeImageUpload) onWelcomeImageUpload(file); e.target.value = '' }}
                      />
                    </div>
                  )}
                </div>
                <div>
                  <Label className="text-xs font-medium text-slate-600 mb-1.5 block">Texto do botão</Label>
                  <Input
                    value={form.welcome_button_text || ''}
                    onChange={(e) => onUpdateForm({ welcome_button_text: e.target.value || null })}
                    className="text-sm"
                    placeholder="Começar"
                  />
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </div>
    )
  }

  // B08: Thank you screen editor
  if (sidebarSection === 'thankyou' && form && onUpdateForm) {
    return (
      <div className="h-full max-w-full overflow-hidden flex flex-col">
        <div className="shrink-0 px-4 py-3 border-b border-slate-100 bg-emerald-50/50">
          <div className="flex items-center gap-2">
            <PartyPopper className="w-4 h-4 text-emerald-500" />
            <span className="text-sm font-medium text-slate-700">Tela de Agradecimento</span>
          </div>
        </div>
        <ScrollArea className="flex-1 max-w-full">
          <div className="p-4 space-y-5 max-w-full overflow-hidden">
            <div>
              <Label className="text-xs font-medium text-slate-600 mb-1.5 block">Título</Label>
              <Input
                value={form.thank_you_title || ''}
                onChange={(e) => onUpdateForm({ thank_you_title: e.target.value || null })}
                className="text-sm"
                placeholder="Obrigado! 🎉"
              />
            </div>
            <div>
              <Label className="text-xs font-medium text-slate-600 mb-1.5 block">Mensagem</Label>
              <Textarea
                value={form.thank_you_description || ''}
                onChange={(e) => onUpdateForm({ thank_you_description: e.target.value || null })}
                className="text-sm"
                placeholder="Sua resposta foi registrada com sucesso."
                rows={3}
              />
            </div>
            <Separator className="my-1" />
            <div>
              <Label className="text-xs font-medium text-slate-600 mb-1.5 block">Botão (opcional)</Label>
              <Input
                value={form.thank_you_button_text || ''}
                onChange={(e) => onUpdateForm({ thank_you_button_text: e.target.value || null })}
                className="text-sm mb-2"
                placeholder="Ex: Voltar ao site"
              />
              <Input
                value={form.thank_you_button_url || ''}
                onChange={(e) => onUpdateForm({ thank_you_button_url: e.target.value || null })}
                className="text-sm"
                placeholder="https://seusite.com.br"
              />
            </div>
            <Separator className="my-1" />
            <div>
              <Label className="text-xs font-medium text-slate-600 mb-1.5 block">Mensagem legada</Label>
              <Textarea
                value={form.thank_you_message || ''}
                onChange={(e) => onUpdateForm({ thank_you_message: e.target.value })}
                className="text-sm"
                placeholder="Obrigado pela sua resposta!"
                rows={2}
              />
              <p className="text-[10px] text-slate-400 mt-1">Usada como fallback se título estiver vazio</p>
            </div>
          </div>
        </ScrollArea>
      </div>
    )
  }

  if (!selectedQuestion) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
          <MousePointerClick className="w-8 h-8 text-slate-300" />
        </div>
        <p className="text-sm font-medium text-slate-500">
          Selecione uma pergunta para editar suas propriedades
        </p>
        <p className="text-xs text-slate-400 mt-1">
          Clique em uma pergunta na lista à esquerda
        </p>
      </div>
    )
  }

  const typeInfo = getQuestionTypeInfo(selectedQuestion.type)
  const [copied, setCopied] = useState(false)

  const handleCopyId = () => {
    navigator.clipboard.writeText(selectedQuestion.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleTypeChange = (newType: QuestionType) => {
    const newTypeInfo = getQuestionTypeInfo(newType)
    const updates: Partial<QuestionConfig> = {
      type: newType,
      ...newTypeInfo?.defaultConfig,
    }
    // Preserve common fields
    if (newType !== 'dropdown' && newType !== 'checkboxes') {
      updates.options = undefined
    }
    onUpdateQuestion(selectedQuestion.id, updates)
  }

  return (
    <div className="h-full max-w-full overflow-hidden flex flex-col">
      {/* Header with question info */}
      <div className="shrink-0 px-4 py-3 border-b border-slate-100 bg-slate-50/50">
        <div className="flex items-center gap-2">
          {typeInfo && <typeInfo.icon className="w-4 h-4 text-blue-600" />}
          <span className="text-sm font-medium text-slate-700 truncate">
            {selectedQuestion.title || 'Pergunta sem título'}
          </span>
        </div>
      </div>
      {/* B14: ID copiável */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 bg-slate-50">
        <span className="text-[11px] text-slate-400 font-mono flex-1 truncate">{selectedQuestion.id}</span>
        <button
          onClick={handleCopyId}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 transition-colors"
          title="Copiar ID"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "Copiado!" : "Copiar ID"}
        </button>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'question' | 'logic')} className="flex-1 flex flex-col overflow-hidden">
        <div className="shrink-0 px-2 pt-2 border-b border-slate-100">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="question" className="text-xs gap-1">
              <Settings2 className="w-3 h-3" />
              Questão
            </TabsTrigger>
            <TabsTrigger value="logic" className="text-xs gap-1">
              <Zap className="w-3 h-3" />
              Lógica
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab: Questão */}
        <TabsContent value="question" className="flex-1 mt-0 overflow-hidden data-[state=inactive]:hidden">
          <ScrollArea className="h-full max-w-full">
            <div className="p-4 space-y-5 max-w-full overflow-hidden">
              {/* Tipo do campo */}
              <div className="w-full max-w-full overflow-hidden">
                <Label className="text-xs font-medium text-slate-600 mb-1.5 block">Tipo do campo</Label>
                <select
                  value={selectedQuestion.type}
                  onChange={(e) => handleTypeChange(e.target.value as QuestionType)}
                  className="w-full max-w-full text-sm text-slate-900 border border-slate-200 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                >
                  {questionTypes.map((qt) => (
                    <option key={qt.type} value={qt.type}>
                      {qt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Campo obrigatório */}
              <div className="flex items-start justify-between gap-3 py-1 max-w-full overflow-hidden">
                <div className="min-w-0 flex-1">
                  <Label className="text-xs font-medium text-slate-700">Campo obrigatório</Label>
                  <p className="text-[10px] text-slate-400">Respondentes devem responder</p>
                </div>
                <Switch
                  checked={selectedQuestion.required}
                  onCheckedChange={(checked) =>
                    onUpdateQuestion(selectedQuestion.id, { required: checked })
                  }
                  className="shrink-0 self-start"
                />
              </div>

              <Separator className="my-1" />

              {/* Full QuestionEditor content (title, description, type-specific options) */}
              <QuestionEditor
                question={selectedQuestion}
                allQuestions={allQuestions}
                onUpdate={(updates) => onUpdateQuestion(selectedQuestion.id, updates)}
                onDelete={() => onDeleteQuestion(selectedQuestion.id)}
                onDuplicate={() => onDuplicateQuestion(selectedQuestion.id)}
                ownerPlan={ownerPlan}
                hideTypeAndRequired
                hideLogic
              />
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Tab: Lógica */}
        <TabsContent value="logic" className="flex-1 mt-0 overflow-hidden data-[state=inactive]:hidden">
          <ScrollArea className="h-full max-w-full">
            <div className="p-4 space-y-5 max-w-full overflow-hidden">
              {/* Existing logic from QuestionEditor - conditional logic + jump rules */}
              <QuestionEditor
                question={selectedQuestion}
                allQuestions={allQuestions}
                onUpdate={(updates) => onUpdateQuestion(selectedQuestion.id, updates)}
                onDelete={() => onDeleteQuestion(selectedQuestion.id)}
                ownerPlan={ownerPlan}
                onlyLogic
              />
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  )
}
