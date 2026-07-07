'use client'

import { QuestionConfig } from '@/lib/database.types'
import type { AnswerSetEvent, AnswerSetCondition, PixelEventConditionOperator } from '@/types/pixel-events'
import { OPERATOR_LABELS, VALUE_OPERATORS } from '@/lib/pixel-events'
import { isChoiceType, answerOptions, genId } from '@/lib/branching'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { X, Plus } from 'lucide-react'

const MAX_EVENTS = 10
const MAX_CONDITIONS = 20

interface AnswerSetEventsEditorProps {
  events: AnswerSetEvent[]
  questions: QuestionConfig[]
  onChange: (events: AnswerSetEvent[]) => void
}

/** Perguntas com resposta comparável (blocos de conteúdo ficam de fora). */
function comparableQuestions(questions: QuestionConfig[]): QuestionConfig[] {
  return questions.filter(q => q.type !== 'html_block' && q.type !== 'content_block')
}

function questionLabel(q: QuestionConfig, index: number): string {
  const title = (q.title || '').trim() || `Pergunta ${index + 1}`
  return title.length > 60 ? `${title.slice(0, 57)}…` : title
}

function splitPipeList(value: string): string[] {
  return (value || '').split('|').map(v => v.trim()).filter(v => v !== '')
}

function emptyCondition(): AnswerSetCondition {
  return { questionId: '', condition: { operator: 'equals', value: '' } }
}

// ── Uma condição: pergunta + operador + valor ───────────────────────────────
function ConditionRow({ cond, questions, onChange, onRemove }: {
  cond: AnswerSetCondition
  questions: QuestionConfig[]
  onChange: (cond: AnswerSetCondition) => void
  onRemove: () => void
}) {
  const comparable = comparableQuestions(questions)
  const q = comparable.find(qq => qq.id === cond.questionId)
  const orphan = cond.questionId !== '' && !q
  const opts = q ? answerOptions(q) : []
  const noValue = !VALUE_OPERATORS.includes(cond.condition.operator)
  // Pergunta de opções + operador de lista → multi-select das opções (gera
  // "op1|op2" pro one_of), em vez de input livre — evita erro de digitação.
  const useOptionPicker = !!q && isChoiceType(q.type) && opts.length > 0 &&
    (cond.condition.operator === 'one_of' || cond.condition.operator === 'not_one_of')
  const selected = new Set(splitPipeList(cond.condition.value))

  const toggleOption = (opt: string) => {
    const next = new Set(selected)
    if (next.has(opt)) next.delete(opt)
    else next.add(opt)
    onChange({ ...cond, condition: { ...cond.condition, value: opts.filter(o => next.has(o)).join('|') } })
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5 space-y-1.5 min-w-0">
      <div className="flex items-center gap-1.5">
        <select
          value={q ? cond.questionId : ''}
          onChange={(e) => {
            const nq = comparable.find(qq => qq.id === e.target.value)
            // Ao trocar de pergunta, zera o valor; pergunta de opções já nasce
            // com one_of (o caminho do multi-select).
            const operator: PixelEventConditionOperator = nq && isChoiceType(nq.type) ? 'one_of' : 'equals'
            onChange({ questionId: e.target.value, condition: { operator, value: '' } })
          }}
          className="flex-1 min-w-0 text-sm rounded-md border px-2 py-1.5 bg-white text-slate-800"
        >
          <option value="" disabled>— escolha a pergunta —</option>
          {comparable.map((qq, i) => (
            <option key={qq.id} value={qq.id}>{questionLabel(qq, i)}</option>
          ))}
        </select>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={onRemove}>
          <X className="w-3 h-3 text-red-400" />
        </Button>
      </div>
      {orphan && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          A pergunta desta condição foi removida do formulário — a condição nunca vai bater. Escolha outra pergunta ou exclua a condição.
        </p>
      )}
      <select
        value={cond.condition.operator}
        onChange={(e) => onChange({ ...cond, condition: { ...cond.condition, operator: e.target.value as PixelEventConditionOperator } })}
        className="w-full min-w-0 max-w-full text-sm rounded-md border px-2 py-1.5 bg-white text-slate-800"
      >
        {Object.entries(OPERATOR_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      {!noValue && (useOptionPicker ? (
        <div className="flex flex-wrap gap-1.5">
          {opts.map(opt => (
            <button
              key={opt}
              type="button"
              onClick={() => toggleOption(opt)}
              className={`text-xs rounded-full border px-2.5 py-1 transition-colors max-w-full whitespace-normal break-words text-left ${
                selected.has(opt)
                  ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      ) : (
        <Input
          value={cond.condition.value}
          onChange={(e) => onChange({ ...cond, condition: { ...cond.condition, value: e.target.value } })}
          placeholder="valor"
          className="text-sm bg-white"
        />
      ))}
    </div>
  )
}

// ── Um evento: nome + condições + regra de disparo ──────────────────────────
function EventCard({ ev, index, questions, onChange, onRemove }: {
  ev: AnswerSetEvent
  index: number
  questions: QuestionConfig[]
  onChange: (ev: AnswerSetEvent) => void
  onRemove: () => void
}) {
  const conditions = ev.conditions || []
  const setConditions = (next: AnswerSetCondition[]) => {
    // Mantém minMatches dentro de [1, nº de condições] quando a lista muda.
    const minMatches = ev.match === 'at_least'
      ? Math.min(Math.max(1, ev.minMatches ?? 1), Math.max(1, next.length))
      : ev.minMatches
    onChange({ ...ev, conditions: next, minMatches })
  }

  return (
    <div className="rounded-xl border-2 border-slate-200 bg-slate-50 p-3 space-y-2.5 min-w-0">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Evento {index + 1}</span>
        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs text-red-500 hover:text-red-600" onClick={onRemove}>
          <X className="w-3 h-3 mr-0.5" /> excluir
        </Button>
      </div>
      <div>
        <Label className="text-xs font-medium text-slate-600">Nome do evento</Label>
        <Input
          value={ev.name}
          onChange={(e) => onChange({ ...ev, name: e.target.value })}
          placeholder="ex.: LeadQualificado"
          className="mt-1 text-sm bg-white"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-slate-600">Condições</Label>
        {conditions.map((cond, i) => (
          <ConditionRow
            key={i}
            cond={cond}
            questions={questions}
            onChange={(c) => setConditions(conditions.map((cc, idx) => (idx === i ? c : cc)))}
            onRemove={() => setConditions(conditions.filter((_, idx) => idx !== i))}
          />
        ))}
        <Button
          variant="outline" size="sm" className="w-full text-xs text-slate-700"
          disabled={conditions.length >= MAX_CONDITIONS}
          onClick={() => setConditions([...conditions, emptyCondition()])}
        >
          <Plus className="w-3 h-3 mr-1" /> adicionar condição
        </Button>
      </div>
      <div className="space-y-1">
        <Label className="text-xs font-medium text-slate-600">Dispara quando</Label>
        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input
            type="radio"
            checked={ev.match === 'all'}
            onChange={() => onChange({ ...ev, match: 'all' })}
            className="accent-emerald-600"
          />
          todas as condições baterem
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input
            type="radio"
            checked={ev.match === 'at_least'}
            onChange={() => onChange({ ...ev, match: 'at_least', minMatches: Math.min(Math.max(1, ev.minMatches ?? 1), Math.max(1, conditions.length)) })}
            className="accent-emerald-600"
          />
          <span className="flex items-center gap-1.5">
            pelo menos
            <select
              value={Math.min(Math.max(1, ev.minMatches ?? 1), Math.max(1, conditions.length))}
              disabled={ev.match !== 'at_least'}
              onChange={(e) => onChange({ ...ev, match: 'at_least', minMatches: parseInt(e.target.value, 10) })}
              className="text-sm rounded-md border px-1.5 py-0.5 bg-white text-slate-800 disabled:opacity-50"
            >
              {Array.from({ length: Math.max(1, conditions.length) }, (_, i) => i + 1).map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            {(ev.match === 'at_least' ? Math.min(Math.max(1, ev.minMatches ?? 1), Math.max(1, conditions.length)) : 1) === 1 ? 'condição bater' : 'condições baterem'}
          </span>
        </label>
      </div>
    </div>
  )
}

// ── Editor (entrada principal) ──────────────────────────────────────────────
export function AnswerSetEventsEditor({ events, questions, onChange }: AnswerSetEventsEditorProps) {
  const addEvent = () => {
    onChange([...events, { id: genId(), name: '', match: 'all', conditions: [emptyCondition()] }])
  }

  return (
    <div className="space-y-3">
      {events.map((ev, i) => (
        <EventCard
          key={ev.id}
          ev={ev}
          index={i}
          questions={questions}
          onChange={(next) => onChange(events.map((e, idx) => (idx === i ? next : e)))}
          onRemove={() => onChange(events.filter((_, idx) => idx !== i))}
        />
      ))}
      <Button
        variant="outline" size="sm" className="w-full text-xs text-slate-700"
        disabled={events.length >= MAX_EVENTS}
        onClick={addEvent}
      >
        <Plus className="w-3 h-3 mr-1" /> adicionar evento
      </Button>
    </div>
  )
}
