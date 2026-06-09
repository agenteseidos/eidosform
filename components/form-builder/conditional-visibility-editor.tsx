'use client'

import { QuestionConfig, ConditionalRule, ConditionalGroup, ConditionalConjunction, ConditionalOperator } from '@/lib/database.types'
import { normalizeConditional } from '@/lib/form-logic-engine'
import { isChoiceType, answerOptions } from '@/lib/branching'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Eye, X, Plus } from 'lucide-react'

interface ConditionalVisibilityEditorProps {
  question: QuestionConfig
  allQuestions: QuestionConfig[]
  onChange: (group: ConditionalGroup | undefined) => void
}

const MAX_RULES = 20

const OPERATORS: { value: ConditionalOperator; label: string }[] = [
  { value: 'equals', label: 'for igual a' },
  { value: 'not_equals', label: 'for diferente de' },
  { value: 'contains', label: 'contiver' },
  { value: 'greater_than', label: 'for maior que' },
  { value: 'less_than', label: 'for menor que' },
  { value: 'not_empty', label: 'estiver preenchida' },
  { value: 'is_empty', label: 'estiver vazia' },
]

const emptyRule = (): ConditionalRule => ({ questionId: '', operator: 'equals', value: '' })

function questionLabel(q: QuestionConfig): string {
  const t = q.title?.trim()
  if (t) return t.length > 50 ? t.slice(0, 50) + '…' : t
  return q.type === 'content_block' || q.type === 'html_block' ? 'Bloco de conteúdo' : 'Pergunta sem título'
}

export function ConditionalVisibilityEditor({ question, allQuestions, onChange }: ConditionalVisibilityEditorProps) {
  const group = normalizeConditional(question.conditionalLogic)
  const rules = group.rules
  const others = allQuestions.filter(q => q.id !== question.id)

  // Emite o grupo; se não sobrar regra nenhuma, limpa a condição (volta a "sempre visível").
  // Regras incompletas (sem questionId) são mantidas no editor para o usuário preencher —
  // o save (form-builder) é quem as descarta.
  const emit = (nextRules: ConditionalRule[], conjunction: ConditionalConjunction = group.conjunction) => {
    if (nextRules.length === 0) { onChange(undefined); return }
    onChange({ conjunction, rules: nextRules })
  }

  const updateRule = (idx: number, patch: Partial<ConditionalRule>) =>
    emit(rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)))

  const addRule = () => { if (rules.length < MAX_RULES) emit([...rules, emptyRule()]) }
  const removeRule = (idx: number) => emit(rules.filter((_, i) => i !== idx))
  const setConjunction = (conjunction: ConditionalConjunction) => emit(rules, conjunction)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 mb-1">
        <Eye className="w-3.5 h-3.5 text-slate-500" />
        <span className="text-xs font-bold uppercase tracking-wide text-slate-600">Quando esta pergunta aparece</span>
      </div>

      {rules.length === 0 ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-slate-500">Sempre visível</span>
          <Button
            variant="outline" size="sm" className="h-8 text-xs"
            onClick={() => emit([emptyRule()])}
          >
            <Plus className="w-3 h-3 mr-1" /> Definir condição
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
          <p className="text-xs text-slate-500">Mostrar esta pergunta quando…</p>

          {/* Seletor E/OU — só faz sentido com 2+ regras */}
          {rules.length >= 2 && (
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span>Combinar:</span>
              <select
                value={group.conjunction}
                onChange={(e) => setConjunction(e.target.value as ConditionalConjunction)}
                className="text-xs rounded-md border px-2 py-1 bg-white text-slate-800 font-medium"
              >
                <option value="and">TODAS as condições (E)</option>
                <option value="or">QUALQUER condição (OU)</option>
              </select>
            </div>
          )}

          {rules.map((rule, idx) => {
            const refQuestion = others.find(q => q.id === rule.questionId)
            const noValue = rule.operator === 'is_empty' || rule.operator === 'not_empty'
            const choiceValues = refQuestion && isChoiceType(refQuestion.type) ? answerOptions(refQuestion) : null
            return (
              <div key={idx} className="rounded-md border border-slate-200 bg-white p-2 space-y-2">
                {idx > 0 && (
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    {group.conjunction === 'or' ? 'OU' : 'E'}
                  </div>
                )}

                <select
                  value={rule.questionId}
                  onChange={(e) => updateRule(idx, { questionId: e.target.value })}
                  className="w-full text-sm rounded-md border px-2 py-1.5 bg-white text-slate-800"
                >
                  <option value="">Selecione uma pergunta</option>
                  {others.map(q => <option key={q.id} value={q.id}>{questionLabel(q)}</option>)}
                </select>

                <select
                  value={rule.operator}
                  onChange={(e) => updateRule(idx, { operator: e.target.value as ConditionalOperator })}
                  className="w-full text-sm rounded-md border px-2 py-1.5 bg-white text-slate-800"
                >
                  {OPERATORS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
                </select>

                {!noValue && (
                  choiceValues && choiceValues.length > 0 ? (
                    <select
                      value={rule.value}
                      onChange={(e) => updateRule(idx, { value: e.target.value })}
                      className="w-full text-sm rounded-md border px-2 py-1.5 bg-white text-slate-800"
                    >
                      <option value="">Selecione a resposta</option>
                      {choiceValues.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  ) : (
                    <Input
                      value={rule.value ?? ''}
                      onChange={(e) => updateRule(idx, { value: e.target.value })}
                      placeholder="Resposta esperada"
                      className="text-sm"
                    />
                  )
                )}

                <Button
                  variant="ghost" size="sm"
                  onClick={() => removeRule(idx)}
                  className="text-red-500 hover:text-red-600 text-xs w-full h-7"
                >
                  <X className="w-3 h-3 mr-1" /> Remover {rules.length > 1 ? 'esta condição' : 'condição'}
                </Button>
              </div>
            )
          })}

          {rules.length < MAX_RULES && (
            <Button
              variant="outline" size="sm"
              onClick={addRule}
              className="w-full h-8 text-xs"
            >
              <Plus className="w-3 h-3 mr-1" /> Adicionar condição
            </Button>
          )}

          <p className="text-[11px] text-slate-400">Linhas sem pergunta selecionada não são salvas.</p>
        </div>
      )}
    </div>
  )
}
