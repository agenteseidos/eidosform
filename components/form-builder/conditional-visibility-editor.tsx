'use client'

import { QuestionConfig, ConditionalRule, ConditionalOperator } from '@/lib/database.types'
import { isChoiceType, answerOptions } from '@/lib/branching'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Eye, X, Plus } from 'lucide-react'

interface ConditionalVisibilityEditorProps {
  question: QuestionConfig
  allQuestions: QuestionConfig[]
  onChange: (rule: ConditionalRule | undefined) => void
}

const OPERATORS: { value: ConditionalOperator; label: string }[] = [
  { value: 'equals', label: 'for igual a' },
  { value: 'not_equals', label: 'for diferente de' },
  { value: 'contains', label: 'contiver' },
  { value: 'not_empty', label: 'estiver preenchida' },
  { value: 'is_empty', label: 'estiver vazia' },
]

function questionLabel(q: QuestionConfig): string {
  const t = q.title?.trim()
  if (t) return t.length > 50 ? t.slice(0, 50) + '…' : t
  return q.type === 'content_block' || q.type === 'html_block' ? 'Bloco de conteúdo' : 'Pergunta sem título'
}

export function ConditionalVisibilityEditor({ question, allQuestions, onChange }: ConditionalVisibilityEditorProps) {
  const rule = question.conditionalLogic
  const others = allQuestions.filter(q => q.id !== question.id)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 mb-1">
        <Eye className="w-3.5 h-3.5 text-slate-500" />
        <span className="text-xs font-bold uppercase tracking-wide text-slate-600">Quando esta pergunta aparece</span>
      </div>

      {!rule ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-slate-500">Sempre visível</span>
          <Button
            variant="outline" size="sm" className="h-8 text-xs"
            onClick={() => onChange({ questionId: '', operator: 'equals', value: '' })}
          >
            <Plus className="w-3 h-3 mr-1" /> Definir condição
          </Button>
        </div>
      ) : (() => {
        const refQuestion = others.find(q => q.id === rule.questionId)
        const noValue = rule.operator === 'is_empty' || rule.operator === 'not_empty'
        const choiceValues = refQuestion && isChoiceType(refQuestion.type) ? answerOptions(refQuestion) : null
        return (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
            <p className="text-xs text-slate-500">Mostrar esta pergunta quando…</p>

            <select
              value={rule.questionId}
              onChange={(e) => onChange({ ...rule, questionId: e.target.value })}
              className="w-full text-sm rounded-md border px-2 py-1.5 bg-white text-slate-800"
            >
              <option value="">Selecione uma pergunta</option>
              {others.map(q => <option key={q.id} value={q.id}>{questionLabel(q)}</option>)}
            </select>

            <select
              value={rule.operator}
              onChange={(e) => onChange({ ...rule, operator: e.target.value as ConditionalOperator })}
              className="w-full text-sm rounded-md border px-2 py-1.5 bg-white text-slate-800"
            >
              {OPERATORS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
            </select>

            {!noValue && (
              choiceValues && choiceValues.length > 0 ? (
                <select
                  value={rule.value}
                  onChange={(e) => onChange({ ...rule, value: e.target.value })}
                  className="w-full text-sm rounded-md border px-2 py-1.5 bg-white text-slate-800"
                >
                  <option value="">Selecione a resposta</option>
                  {choiceValues.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              ) : (
                <Input
                  value={rule.value}
                  onChange={(e) => onChange({ ...rule, value: e.target.value })}
                  placeholder="Resposta esperada"
                  className="text-sm"
                />
              )
            )}

            <Button
              variant="ghost" size="sm"
              onClick={() => onChange(undefined)}
              className="text-red-500 hover:text-red-600 text-xs w-full h-7"
            >
              <X className="w-3 h-3 mr-1" /> Remover condição
            </Button>
          </div>
        )
      })()}
    </div>
  )
}
