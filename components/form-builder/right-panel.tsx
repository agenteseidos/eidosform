'use client'

import { useState } from 'react'
import { QuestionConfig, QuestionType } from '@/lib/database.types'
import { questionTypes, getQuestionTypeInfo } from '@/lib/questions'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import {
  Copy,
  FileText,
  GitBranch,
  MousePointerClick,
  Settings2,
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
}

export function RightPanel({
  selectedQuestion,
  allQuestions,
  onUpdateQuestion,
  onDeleteQuestion,
  onDuplicateQuestion,
  ownerPlan = 'free',
}: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<'question' | 'logic'>('question')

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

  const copyFieldId = () => {
    navigator.clipboard.writeText(selectedQuestion.id)
    toast.success('ID copiado!')
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
    <div className="h-full flex flex-col">
      {/* Header with question info */}
      <div className="shrink-0 px-4 py-3 border-b border-slate-100 bg-slate-50/50">
        <div className="flex items-center gap-2 mb-1">
          {typeInfo && <typeInfo.icon className="w-4 h-4 text-blue-600" />}
          <span className="text-sm font-medium text-slate-700 truncate">
            {selectedQuestion.title || 'Pergunta sem título'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <code className="text-[10px] text-slate-400 font-mono truncate max-w-[180px]">
            {selectedQuestion.id}
          </code>
          <button
            onClick={copyFieldId}
            className="p-0.5 rounded hover:bg-slate-200 transition-colors"
            title="Copiar ID do campo"
          >
            <Copy className="w-3 h-3 text-slate-400" />
          </button>
        </div>
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
          <ScrollArea className="h-full">
            <div className="p-4 space-y-5">
              {/* Tipo do campo */}
              <div>
                <Label className="text-xs font-medium text-slate-600 mb-1.5 block">Tipo do campo</Label>
                <select
                  value={selectedQuestion.type}
                  onChange={(e) => handleTypeChange(e.target.value as QuestionType)}
                  className="w-full text-sm text-slate-900 border border-slate-200 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                >
                  {questionTypes.map((qt) => (
                    <option key={qt.type} value={qt.type}>
                      {qt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Campo obrigatório */}
              <div className="flex items-center justify-between py-1">
                <div>
                  <Label className="text-xs font-medium text-slate-700">Campo obrigatório</Label>
                  <p className="text-[10px] text-slate-400">Respondentes devem responder</p>
                </div>
                <Switch
                  checked={selectedQuestion.required}
                  onCheckedChange={(checked) =>
                    onUpdateQuestion(selectedQuestion.id, { required: checked })
                  }
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
          <ScrollArea className="h-full">
            <div className="p-4 space-y-5">
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
