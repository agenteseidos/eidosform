'use client'

import { QuestionConfig, ConditionalOperator } from '@/lib/database.types'
import { getQuestionTypeInfo } from '@/lib/questions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { X, GitBranch, CalendarClock, Code, Plus } from 'lucide-react'
import { countries } from '@/lib/countries'
import { PixelEventRulesEditor } from './pixel-event-rules-editor'
import { TiptapEditor } from '@/components/ui/tiptap/TiptapEditor'
import { JumpRulesEditor } from './jump-rules-editor'

interface QuestionEditorProps {
  question: QuestionConfig
  allQuestions?: QuestionConfig[]
  onUpdate: (updates: Partial<QuestionConfig>) => void
  ownerPlan?: string
  /** Hide type badge and required toggle (shown in right panel header instead) */
  hideTypeAndRequired?: boolean
  /** Hide logic sections (conditional, jump rules, pixel events) */
  hideLogic?: boolean
  /** Show ONLY logic sections */
  onlyLogic?: boolean
}

export function QuestionEditor({ question, allQuestions = [], onUpdate, ownerPlan = 'free', hideTypeAndRequired, hideLogic, onlyLogic }: QuestionEditorProps) {
  const typeInfo = getQuestionTypeInfo(question.type)
  const isCalendlyQuestion = question.type === 'calendly'
  const isHtmlBlockQuestion = question.type === 'html_block'

  // If onlyLogic mode, render just the logic sections
  if (onlyLogic) {
    return (
      <div className="space-y-6">
        {/* Jump Rules — prioritário: "se responder X → ir para Y / encerrar" */}
        <div>
          <JumpRulesEditor
            rules={question.jumpRules || []}
            questionId={question.id}
            allQuestions={allQuestions}
            onChange={(jumpRules) => onUpdate({ jumpRules })}
          />
        </div>

        <Separator />

        {/* Conditional Logic */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-slate-500" />
              <Label className="text-sm font-medium text-slate-700">Exibição Condicional</Label>
            </div>
          </div>
          {question.conditionalLogic ? (
            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 space-y-3">
              <p className="text-xs text-slate-500 font-medium">Mostrar esta pergunta se:</p>
              <select
                aria-label="Pergunta da condição"
                value={question.conditionalLogic.questionId || ''}
                onChange={(e) => onUpdate({ conditionalLogic: { ...question.conditionalLogic!, questionId: e.target.value } })}
                className="w-full max-w-full text-sm text-slate-900 border rounded-md px-2 py-1.5 bg-white"
              >
                <option value="">Selecione uma pergunta</option>
                {allQuestions.filter(q => q.id !== question.id).map(q => (
                  <option key={q.id} value={q.id}>{q.title || 'Pergunta sem título'}</option>
                ))}
              </select>
              <select
                aria-label="Operador da condição"
                value={question.conditionalLogic.operator || 'equals'}
                onChange={(e) => onUpdate({ conditionalLogic: { ...question.conditionalLogic!, operator: e.target.value as ConditionalOperator } })}
                className="w-full max-w-full text-sm text-slate-900 border rounded-md px-2 py-1.5 bg-white"
              >
                <option value="equals">é igual a</option>
                <option value="not_equals">é diferente de</option>
                <option value="contains">contém</option>
                <option value="not_empty">não está vazio</option>
                <option value="is_empty">está vazio</option>
              </select>
              {!['not_empty', 'is_empty'].includes(question.conditionalLogic.operator) && (
                <Input
                  aria-label="Valor da condição"
                  value={question.conditionalLogic.value || ''}
                  onChange={(e) => onUpdate({ conditionalLogic: { ...question.conditionalLogic!, value: e.target.value } })}
                  placeholder="Valor esperado"
                  className="w-full max-w-full text-sm"
                />
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onUpdate({ conditionalLogic: undefined })}
                className="text-red-500 hover:text-red-600 text-xs w-full"
              >
                <X className="w-3 h-3 mr-1" />
                Remover condição
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onUpdate({ conditionalLogic: { questionId: '', operator: 'equals', value: '' } })}
              className="w-full text-xs text-slate-700"
            >
              <Plus className="w-3 h-3 mr-1" />
              Adicionar condição
            </Button>
          )}
        </div>

        <Separator />

        {/* Pixel Events */}
        <PixelEventRulesEditor
          rules={question.pixelEvents || []}
          onChange={(pixelEvents) => onUpdate({ pixelEvents })}
          hasPixelPlan={ownerPlan === 'plus' || ownerPlan === 'professional'}
        />
      </div>
    )
  }

  return (
    <div className={hideTypeAndRequired ? 'space-y-6 w-full max-w-full overflow-hidden' : 'p-4 space-y-6 w-full max-w-full overflow-hidden'}>
      {/* Question Type Badge */}
      {!hideTypeAndRequired && (
      <div className="flex items-center gap-2">
        {typeInfo && <typeInfo.icon className="w-4 h-4 text-blue-600" />}
        <span className="text-sm font-medium text-slate-600">{typeInfo?.label}</span>
      </div>
      )}

      {/* Calendly-specific config */}
      {isCalendlyQuestion && (
        <div className="rounded-xl border border-cyan-200 bg-cyan-50/60 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-100 text-cyan-700">
              <CalendarClock className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-900">Integração Calendly</h3>
              <p className="text-xs text-slate-600 mt-1">
                Configure a URL do evento para exibir o widget de agendamento no formulário.
              </p>
            </div>
          </div>

          <div>
            <Label htmlFor="calendlyUrl" className="text-sm font-medium text-slate-700">URL do Calendly</Label>
            <Input
              id="calendlyUrl"
              value={question.calendlyUrl || ''}
              onChange={(e) => onUpdate({ calendlyUrl: e.target.value })}
              placeholder="https://calendly.com/seu-usuario/30min"
              className="mt-2"
            />
            <p className="text-xs text-slate-500 mt-1.5">Cole a URL do seu evento Calendly</p>
          </div>
        </div>
      )}

      {/* HTML Block config */}
      {isHtmlBlockQuestion && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-200 text-slate-700">
              <Code className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-900">Bloco HTML</h3>
              <p className="text-xs text-slate-600 mt-1">
                Cole o código de embed (Google Calendar, YouTube, Maps, etc.). Aceita iframe e HTML.
              </p>
            </div>
          </div>

          <div>
            <Label htmlFor="htmlContent" className="text-sm font-medium text-slate-700">Código HTML / Embed</Label>
            <textarea
              id="htmlContent"
              value={question.htmlContent || ''}
              onChange={(e) => onUpdate({ htmlContent: e.target.value })}
              placeholder='<iframe src="https://calendar.google.com/calendar/embed?src=..." style="border: 0" width="100%" height="600"></iframe>'
              className="mt-2 w-full min-h-[160px] rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-mono shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
              spellCheck={false}
            />
            <p className="text-xs text-slate-500 mt-1.5">Cole o código exatamente como recebeu — iframes HTTPS funcionam direto.</p>
          </div>

          <div>
            <Label className="text-sm font-medium text-slate-700">Instrução para o respondente (opcional)</Label>
            <div className="mt-2 rounded-md border border-slate-300 bg-white">
              <TiptapEditor
                value={question.htmlBlockNote || ''}
                onChange={(v) => onUpdate({ htmlBlockNote: v })}
                placeholder='Ex: Após agendar, clique em "Enviar" abaixo 👇'
              />
            </div>
            <p className="text-xs text-slate-500 mt-1.5">Aparece abaixo do embed, sem caixa, formatável (negrito, itálico, emoji, link).</p>
          </div>
        </div>
      )}

      {/* Content Block config — edição inline no preview via Tiptap */}
      {question.type === 'content_block' && (
        <div className="space-y-4">
          <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2.5">
            <p className="text-xs text-blue-700 font-medium mb-0.5">✏️ Edição inline ativa</p>
            <p className="text-[11px] text-blue-600 leading-snug">Clique no bloco de conteúdo no preview para editar. A toolbar aparece no topo do editor quando o bloco entra em foco.</p>
          </div>
          <Separator />
          <div>
            <Label htmlFor="content-button-text" className="text-sm font-medium text-slate-700 mb-1.5 block">Texto do botão</Label>
            <Input
              id="content-button-text"
              value={question.contentButtonText || ''}
              onChange={(e) => onUpdate({ contentButtonText: e.target.value })}
              placeholder="Continuar"
              className="text-sm mb-2"
            />
            <Input
              aria-label="URL do botão (opcional)"
              value={question.contentButtonUrl || ''}
              onChange={(e) => onUpdate({ contentButtonUrl: e.target.value })}
              placeholder="URL opcional (se quiser abrir link externo)"
              className="text-sm"
            />
            <p className="text-[10px] text-slate-500 mt-1">Sem URL, o botão continua para a próxima etapa.</p>
          </div>
        </div>
      )}

      {/* Type-specific technical settings */}

      {question.type === 'rating' && (
        <div>
          <Label className="text-sm font-medium text-slate-700 mb-3 block">Escala de Avaliação</Label>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Label htmlFor="minValue" className="text-xs text-slate-500">Min</Label>
              <Input
                id="minValue"
                type="number"
                value={question.minValue || 1}
                onChange={(e) => onUpdate({ minValue: parseInt(e.target.value) || 1 })}
                min={1}
                max={4}
                className="mt-1 text-slate-900"
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="maxValue" className="text-xs text-slate-500">Max</Label>
              <Input
                id="maxValue"
                type="number"
                value={question.maxValue || 5}
                onChange={(e) => onUpdate({ maxValue: parseInt(e.target.value) || 5 })}
                min={2}
                max={10}
                className="mt-1 text-slate-900"
              />
            </div>
          </div>
        </div>
      )}

      {question.type === 'opinion_scale' && (
        <div>
          <Label className="text-sm font-medium text-slate-700 mb-3 block">Faixa da Escala</Label>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Label htmlFor="minValue" className="text-xs text-slate-500">Min</Label>
              <Input
                id="minValue"
                type="number"
                value={question.minValue || 1}
                onChange={(e) => onUpdate({ minValue: parseInt(e.target.value) || 1 })}
                min={0}
                max={1}
                className="mt-1 text-slate-900"
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="maxValue" className="text-xs text-slate-500">Max</Label>
              <Input
                id="maxValue"
                type="number"
                value={question.maxValue || 10}
                onChange={(e) => onUpdate({ maxValue: parseInt(e.target.value) || 10 })}
                min={5}
                max={10}
                className="mt-1 text-slate-900"
              />
            </div>
          </div>
        </div>
      )}

      {question.type === 'nps' && (
        <div>
          <Label className="text-sm font-medium text-slate-700 mb-3 block">Escala NPS (0-10)</Label>
          <p className="text-sm text-slate-500">Net Promoter Score: 0-6 Detratores, 7-8 Passivos, 9-10 Promotores</p>
        </div>
      )}
      {question.type === 'phone' && (
        <div>
          <Label htmlFor="phone-default-country" className="text-sm font-medium text-slate-700 mb-2 block">País padrão</Label>
          <select
            id="phone-default-country"
            value={question.defaultCountry || 'BR'}
            onChange={(e) => onUpdate({ defaultCountry: e.target.value })}
            className="w-full max-w-full text-sm text-slate-900 border rounded-md px-2 py-1.5 bg-white"
          >
            {countries.map(c => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.name} ({c.dial})
              </option>
            ))}
          </select>
        </div>
      )}


      {question.type === 'file_upload' && (
        <div className="space-y-4">
          <div>
            <Label className="text-sm font-medium text-slate-700 mb-2 block">Tipos de arquivo permitidos</Label>
            <p className="text-sm text-slate-500">Imagens e PDFs são permitidos</p>
          </div>
          <div>
            <Label htmlFor="maxFileSize" className="text-sm font-medium text-slate-700">Tamanho máximo (MB)</Label>
            <Input
              id="maxFileSize"
              type="number"
              value={question.maxFileSize || 10}
              onChange={(e) => onUpdate({ maxFileSize: parseInt(e.target.value) || 10 })}
              min={1}
              max={25}
              className="mt-2 text-slate-900"
            />
          </div>
        </div>
      )}

      <Separator />

      {/* Required toggle */}
      {!hideTypeAndRequired && (
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="required-toggle" className="text-sm font-medium text-slate-700">Obrigatório</Label>
          <p className="text-xs text-slate-500">Respondentes devem responder esta pergunta</p>
        </div>
        <Switch
          id="required-toggle"
          checked={question.required}
          onCheckedChange={(checked) => onUpdate({ required: checked })}
        />
      </div>
      )}

      {!hideTypeAndRequired && <Separator />}


      {/* Logic sections */}
      {!hideLogic && (
      <>
      {/* Navegação / Pular para — prioritário */}
      <div>
        <JumpRulesEditor
          rules={question.jumpRules || []}
          questionId={question.id}
          allQuestions={allQuestions}
          onChange={(jumpRules) => onUpdate({ jumpRules })}
        />
      </div>

      <Separator />

      {/* Exibição Condicional */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-slate-500" />
            <Label className="text-sm font-medium text-slate-700">Exibição Condicional</Label>
          </div>
        </div>
        {question.conditionalLogic ? (
          <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 space-y-3">
            <p className="text-xs text-slate-500 font-medium">Mostrar esta pergunta se:</p>
            <select
              aria-label="Pergunta da condição"
              value={question.conditionalLogic.questionId || ''}
              onChange={(e) => onUpdate({ conditionalLogic: { ...question.conditionalLogic!, questionId: e.target.value } })}
              className="w-full max-w-full text-sm text-slate-900 border rounded-md px-2 py-1.5 bg-white"
            >
              <option value="">Selecione uma pergunta</option>
              {allQuestions.filter(q => q.id !== question.id).map(q => (
                <option key={q.id} value={q.id}>{q.title || 'Pergunta sem título'}</option>
              ))}
            </select>
            <select
              aria-label="Operador da condição"
              value={question.conditionalLogic.operator || 'equals'}
              onChange={(e) => onUpdate({ conditionalLogic: { ...question.conditionalLogic!, operator: e.target.value as ConditionalOperator } })}
              className="w-full max-w-full text-sm text-slate-900 border rounded-md px-2 py-1.5 bg-white"
            >
              <option value="equals">é igual a</option>
              <option value="not_equals">é diferente de</option>
              <option value="contains">contém</option>
              <option value="not_empty">não está vazio</option>
              <option value="is_empty">está vazio</option>
            </select>
            {!['not_empty', 'is_empty'].includes(question.conditionalLogic.operator) && (
              <Input
                aria-label="Valor da condição"
                value={question.conditionalLogic.value || ''}
                onChange={(e) => onUpdate({ conditionalLogic: { ...question.conditionalLogic!, value: e.target.value } })}
                placeholder="Valor esperado"
                className="text-sm"
              />
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onUpdate({ conditionalLogic: undefined })}
              className="text-red-500 hover:text-red-600 text-xs w-full"
            >
              <X className="w-3 h-3 mr-1" />
              Remover condição
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onUpdate({ conditionalLogic: { questionId: '', operator: 'equals', value: '' } })}
            className="w-full text-xs text-slate-700"
          >
            <Plus className="w-3 h-3 mr-1" />
            Adicionar condição
          </Button>
        )}
      </div>

      <Separator />

      {/* Pixel Events Condicionais */}
      <PixelEventRulesEditor
        rules={question.pixelEvents || []}
        onChange={(pixelEvents) => onUpdate({ pixelEvents })}
        hasPixelPlan={ownerPlan === 'plus' || ownerPlan === 'professional'}
      />

      <Separator />
      </>
      )}
    </div>
  )
}
