'use client'

import { QuestionConfig, ConditionalRule, ConditionalOperator } from '@/lib/database.types'
import { getQuestionTypeInfo } from '@/lib/questions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Trash2, Plus, GripVertical, X, GitBranch } from 'lucide-react'

interface QuestionEditorProps {
  question: QuestionConfig
  allQuestions?: QuestionConfig[]
  onUpdate: (updates: Partial<QuestionConfig>) => void
  onDelete: () => void
}

export function QuestionEditor({ question, allQuestions = [], onUpdate, onDelete }: QuestionEditorProps) {
  const typeInfo = getQuestionTypeInfo(question.type)

  const addOption = () => {
    const options = question.options || []
    onUpdate({ options: [...options, `Opção ${options.length + 1}`] })
  }

  const updateOption = (index: number, value: string) => {
    const options = [...(question.options || [])]
    options[index] = value
    onUpdate({ options })
  }

  const deleteOption = (index: number) => {
    const options = (question.options || []).filter((_, i) => i !== index)
    onUpdate({ options })
  }

  return (
    <div className="p-4 space-y-6">
      {/* Question Type Badge */}
      <div className="flex items-center gap-2">
        {typeInfo && <typeInfo.icon className="w-4 h-4 text-blue-600" />}
        <span className="text-sm font-medium text-slate-600">{typeInfo?.label}</span>
      </div>

      {/* Question Title */}
      <div>
        <Label htmlFor="title" className="text-sm font-medium text-slate-900">Pergunta</Label>
        <Textarea
          id="title"
          value={question.title}
          onChange={(e) => onUpdate({ title: e.target.value })}
          placeholder="Digite sua pergunta aqui..."
          className="mt-2 resize-none"
          rows={2}
        />
      </div>

      {/* Description */}
      <div>
        <Label htmlFor="description" className="text-sm font-medium">
          Descrição <span className="text-slate-400 font-normal">(opcional)</span>
        </Label>
        <Textarea
          id="description"
          value={question.description || ''}
          onChange={(e) => onUpdate({ description: e.target.value })}
          placeholder="Adicione uma descrição..."
          className="mt-2 resize-none"
          rows={2}
        />
      </div>

      <Separator />

      {/* Type-specific settings */}
      {(question.type === 'dropdown' || question.type === 'checkboxes') && (
        <div>
          <Label className="text-sm font-medium mb-3 block">Opções</Label>
          <div className="space-y-2">
            {(question.options || []).map((option, index) => (
              <div
                key={index}
                className="flex items-center gap-2"
              >
                <div className="cursor-grab active:cursor-grabbing">
                  <GripVertical className="w-4 h-4 text-slate-300" />
                </div>
                <Input
                  value={option}
                  onChange={(e) => updateOption(index, e.target.value)}
                  placeholder={`Opção ${index + 1}`}
                  className="flex-1"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteOption(index)}
                  className="h-8 w-8 p-0"
                  disabled={(question.options?.length || 0) <= 1}
                >
                  <X className="w-4 h-4 text-slate-400" />
                </Button>
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={addOption}
            className="mt-3 w-full"
          >
            <Plus className="w-4 h-4 mr-2" />
            Adicionar opção
          </Button>
        </div>
      )}

      {(question.type === 'short_text' || question.type === 'long_text' || 
        question.type === 'email' || question.type === 'phone' || 
        question.type === 'url' || question.type === 'number') && (
        <div>
          <Label htmlFor="placeholder" className="text-sm font-medium">Placeholder</Label>
          <Input
            id="placeholder"
            value={question.placeholder || ''}
            onChange={(e) => onUpdate({ placeholder: e.target.value })}
            placeholder="Texto do placeholder..."
            className="mt-2"
          />
        </div>
      )}

      {question.type === 'rating' && (
        <div>
          <Label className="text-sm font-medium mb-3 block">Escala de Avaliação</Label>
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
                className="mt-1"
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
                className="mt-1"
              />
            </div>
          </div>
        </div>
      )}

      {question.type === 'opinion_scale' && (
        <div>
          <Label className="text-sm font-medium mb-3 block">Faixa da Escala</Label>
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
                className="mt-1"
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
                className="mt-1"
              />
            </div>
          </div>
        </div>
      )}

      {question.type === 'nps' && (
        <div>
          <Label className="text-sm font-medium mb-3 block">Escala NPS (0-10)</Label>
          <p className="text-sm text-slate-500">Net Promoter Score: 0-6 Detratores, 7-8 Passivos, 9-10 Promotores</p>
        </div>
      )}
      {question.type === 'file_upload' && (
        <div className="space-y-4">
          <div>
            <Label className="text-sm font-medium mb-2 block">Tipos de arquivo permitidos</Label>
            <p className="text-sm text-slate-500">Imagens e PDFs são permitidos</p>
          </div>
          <div>
            <Label htmlFor="maxFileSize" className="text-sm font-medium">Tamanho máximo (MB)</Label>
            <Input
              id="maxFileSize"
              type="number"
              value={question.maxFileSize || 10}
              onChange={(e) => onUpdate({ maxFileSize: parseInt(e.target.value) || 10 })}
              min={1}
              max={25}
              className="mt-2"
            />
          </div>
        </div>
      )}

      <Separator />

      {/* Required toggle */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Obrigatório</Label>
          <p className="text-xs text-slate-500">Respondentes devem responder esta pergunta</p>
        </div>
        <Switch
          checked={question.required}
          onCheckedChange={(checked) => onUpdate({ required: checked })}
        />
      </div>

      <Separator />


      {/* Conditional Logic */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-slate-500" />
            <Label className="text-sm font-medium">Lógica Condicional</Label>
          </div>
        </div>
        {question.conditionalLogic ? (
          <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 space-y-3">
            <p className="text-xs text-slate-500 font-medium">Mostrar esta pergunta se:</p>
            <select
              value={question.conditionalLogic.questionId || ''}
              onChange={(e) => onUpdate({ conditionalLogic: { ...question.conditionalLogic!, questionId: e.target.value } })}
              className="w-full text-sm border rounded-md px-2 py-1.5 bg-white"
            >
              <option value="">Selecione uma pergunta</option>
              {allQuestions.filter(q => q.id !== question.id).map(q => (
                <option key={q.id} value={q.id}>{q.title || 'Pergunta sem título'}</option>
              ))}
            </select>
            <select
              value={question.conditionalLogic.operator || 'equals'}
              onChange={(e) => onUpdate({ conditionalLogic: { ...question.conditionalLogic!, operator: e.target.value as ConditionalOperator } })}
              className="w-full text-sm border rounded-md px-2 py-1.5 bg-white"
            >
              <option value="equals">é igual a</option>
              <option value="not_equals">é diferente de</option>
              <option value="contains">contém</option>
              <option value="not_empty">não está vazio</option>
              <option value="is_empty">está vazio</option>
            </select>
            {!['not_empty', 'is_empty'].includes(question.conditionalLogic.operator) && (
              <Input
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
            className="w-full text-xs"
          >
            <Plus className="w-3 h-3 mr-1" />
            Adicionar condição
          </Button>
        )}
      </div>

      <Separator />

      {/* Delete button */}
      <Button
        variant="outline"
        onClick={onDelete}
        className="w-full text-red-600 hover:text-red-700 hover:bg-red-50"
      >
        <Trash2 className="w-4 h-4 mr-2" />
        Excluir pergunta
      </Button>
    </div>
  )
}
