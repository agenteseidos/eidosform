'use client'

import { JumpRule, JUMP_OPERATORS } from '@/lib/jump-logic'
import { QuestionConfig } from '@/lib/database.types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, X, ArrowRight, Send } from 'lucide-react'

interface JumpRulesEditorProps {
  rules: JumpRule[]
  questionId: string
  allQuestions: QuestionConfig[]
  onChange: (rules: JumpRule[]) => void
}

export function JumpRulesEditor({ rules, questionId, allQuestions, onChange }: JumpRulesEditorProps) {
  const otherQuestions = allQuestions.filter(q => q.id !== questionId)

  const addRule = () => {
    const newRule: JumpRule = {
      id: crypto.randomUUID(),
      condition: {
        questionId: questionId,
        operator: 'equals',
        value: '',
      },
      action: {
        type: 'jump',
        targetQuestionId: '',
      },
    }
    onChange([...rules, newRule])
  }

  const updateRule = (index: number, updates: Partial<JumpRule>) => {
    const updated = rules.map((r, i) => {
      if (i !== index) return r
      return { ...r, ...updates }
    })
    onChange(updated)
  }

  const updateCondition = (index: number, updates: Partial<JumpRule['condition']>) => {
    const updated = rules.map((r, i) => {
      if (i !== index) return r
      return { ...r, condition: { ...r.condition, ...updates } }
    })
    onChange(updated)
  }

  const updateAction = (index: number, updates: Partial<JumpRule['action']>) => {
    const updated = rules.map((r, i) => {
      if (i !== index) return r
      return { ...r, action: { ...r.action, ...updates } }
    })
    onChange(updated)
  }

  const deleteRule = (index: number) => {
    onChange(rules.filter((_, i) => i !== index))
  }

  // Verifica se a pergunta referenciada é select/yes_no para mostrar dropdown de valores
  const getConditionQuestion = (condQuestionId: string) => {
    return allQuestions.find(q => q.id === condQuestionId)
  }

  const getQuestionLabel = (q: QuestionConfig) => {
    return q.title ? (q.title.length > 40 ? q.title.slice(0, 40) + '…' : q.title) : 'Pergunta sem título'
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium text-slate-700">Regras de Navegação</Label>
      </div>

      <p className="text-xs text-slate-500">
        Defina para onde o respondente vai após esta pergunta, com base nas respostas.
        Se nenhuma regra bater, segue para a próxima pergunta.
      </p>

      {rules.map((rule, index) => {
        const condQuestion = getConditionQuestion(rule.condition.questionId)
        const showValueDropdown = condQuestion && (
          condQuestion.type === 'dropdown' ||
          condQuestion.type === 'yes_no' ||
          condQuestion.type === 'checkboxes'
        )

        return (
          <div key={rule.id} className="p-3 rounded-lg border border-slate-200 bg-slate-50 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">Regra {index + 1}</span>
              <Button variant="ghost" size="sm" onClick={() => deleteRule(index)} className="h-6 w-6 p-0">
                <X className="w-3 h-3 text-red-400" />
              </Button>
            </div>

            {/* SE */}
            <div className="space-y-1.5">
              <span className="text-xs font-bold text-blue-600">SE</span>
              <select
                value={rule.condition.questionId}
                onChange={(e) => updateCondition(index, { questionId: e.target.value })}
                className="w-full text-sm text-slate-900 border rounded-md px-2 py-1.5 bg-white"
              >
                <option value="">Selecione uma pergunta</option>
                {allQuestions.map(q => (
                  <option key={q.id} value={q.id}>{getQuestionLabel(q)}</option>
                ))}
              </select>

              <select
                value={rule.condition.operator}
                onChange={(e) => updateCondition(index, { operator: e.target.value as JumpRule['condition']['operator'] })}
                className="w-full text-sm text-slate-900 border rounded-md px-2 py-1.5 bg-white"
              >
                {JUMP_OPERATORS.map(op => (
                  <option key={op.value} value={op.value}>{op.label}</option>
                ))}
              </select>

              {showValueDropdown ? (
                <select
                  value={rule.condition.value}
                  onChange={(e) => updateCondition(index, { value: e.target.value })}
                  className="w-full text-sm text-slate-900 border rounded-md px-2 py-1.5 bg-white"
                >
                  <option value="">Selecione um valor</option>
                  {condQuestion.type === 'yes_no' ? (
                    <>
                      <option value="Sim">Sim</option>
                      <option value="Não">Não</option>
                    </>
                  ) : (
                    (condQuestion.options || []).map((opt, i) => (
                      <option key={i} value={opt}>{opt}</option>
                    ))
                  )}
                </select>
              ) : (
                <Input
                  value={rule.condition.value}
                  onChange={(e) => updateCondition(index, { value: e.target.value })}
                  placeholder="Valor esperado"
                  className="text-sm"
                />
              )}
            </div>

            {/* ENTÃO */}
            <div className="space-y-1.5">
              <span className="text-xs font-bold text-green-600">ENTÃO</span>
              <select
                value={rule.action.type === 'submit' ? '__submit__' : (rule.action.targetQuestionId || '')}
                onChange={(e) => {
                  if (e.target.value === '__submit__') {
                    updateAction(index, { type: 'submit', targetQuestionId: undefined })
                  } else {
                    updateAction(index, { type: 'jump', targetQuestionId: e.target.value })
                  }
                }}
                className="w-full text-sm text-slate-900 border rounded-md px-2 py-1.5 bg-white"
              >
                <option value="">Selecione o destino</option>
                {otherQuestions.map(q => (
                  <option key={q.id} value={q.id}>
                    ↳ Ir para: {getQuestionLabel(q)}
                  </option>
                ))}
                <option value="__submit__">✅ Enviar formulário</option>
              </select>
            </div>

            {/* Preview da regra */}
            <div className="flex items-center gap-1 text-[10px] text-slate-400 pt-1">
              {rule.action.type === 'submit' ? (
                <><Send className="w-3 h-3" /> Envia o formulário</>
              ) : rule.action.targetQuestionId ? (
                <><ArrowRight className="w-3 h-3" /> Pula para outra pergunta</>
              ) : null}
            </div>
          </div>
        )
      })}

      <Button variant="outline" size="sm" onClick={addRule} className="w-full text-xs text-slate-700">
        <Plus className="w-3 h-3 mr-1" />
        Adicionar regra
      </Button>

      {rules.length > 0 && (
        <p className="text-[10px] text-slate-400 italic">
          SENÃO: segue para a próxima pergunta (comportamento padrão)
        </p>
      )}
    </div>
  )
}
