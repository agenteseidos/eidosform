'use client'

import { QuestionConfig } from '@/lib/database.types'
import type { PixelEventRule, PixelEventConfig } from '@/types/pixel-events'
import { STANDARD_PIXEL_EVENTS, OPERATOR_LABELS, VALUE_OPERATORS } from '@/lib/pixel-events'
import {
  getAnswerEvent, setAnswerEvent, unhandledPixelRules,
  getBlockEvent, setBlockEvent, defaultEvent,
} from '@/lib/pixel-branching'
import { isChoiceType, answerOptions, genId } from '@/lib/branching'
import { AnswerChip } from './branching-editor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowRight, Target, X, Plus, Lock } from 'lucide-react'

interface PixelBranchingEditorProps {
  question: QuestionConfig
  onChange: (rules: PixelEventRule[]) => void
  hasPixelPlan: boolean
}

const NONE = '__none__'
const CUSTOM = '__custom__'

function PixelSectionHeader() {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      <Target className="w-3.5 h-3.5 text-emerald-600" />
      <span className="text-xs font-bold uppercase tracking-wide text-emerald-600">Conversões</span>
    </div>
  )
}

// ── Seletor de evento de pixel ──────────────────────────────────────────────
function EventPicker({ event, onChange }: {
  event: PixelEventConfig | null
  onChange: (e: PixelEventConfig | null) => void
}) {
  const selectValue = !event ? NONE : (event.type === 'custom' ? CUSTOM : event.name)
  return (
    <div className="space-y-1.5">
      <select
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value
          if (v === NONE) return onChange(null)
          if (v === CUSTOM) return onChange({ ...event, type: 'custom', name: event?.type === 'custom' ? event.name : '' })
          onChange({ ...event, type: 'standard', name: v })
        }}
        className={`w-full text-sm rounded-lg border-2 px-2.5 py-2 bg-white transition-colors ${
          event ? 'border-emerald-200 text-emerald-800' : 'border-slate-200 text-slate-500'
        }`}
      >
        <option value={NONE}>— nenhum evento —</option>
        <optgroup label="Eventos padrão">
          {STANDARD_PIXEL_EVENTS.map(ev => <option key={ev} value={ev}>🎯 {ev}</option>)}
        </optgroup>
        <option value={CUSTOM}>✎ Personalizado…</option>
      </select>

      {event?.type === 'custom' && (
        <Input
          value={event.name}
          onChange={(e) => onChange({ ...event, name: e.target.value })}
          placeholder="Nome do evento (ex.: LeadQualificado)"
          className="text-sm"
        />
      )}

      {event && (
        <div className="flex gap-2">
          <Input
            type="number"
            value={event.value ?? ''}
            onChange={(e) => onChange({ ...event, value: e.target.value ? parseFloat(e.target.value) : undefined })}
            placeholder="Valor da conversão (opcional)"
            className="text-sm flex-1"
          />
          <Input
            value={event.currency ?? 'BRL'}
            onChange={(e) => onChange({ ...event, currency: e.target.value })}
            className="text-sm w-16"
          />
        </div>
      )}
    </div>
  )
}

// ── Conversões de perguntas abertas (regra em linguagem natural) ────────────
function OpenPixel({ rules, onChange }: {
  rules: PixelEventRule[]
  onChange: (rules: PixelEventRule[]) => void
}) {
  const update = (i: number, patch: Partial<PixelEventRule>) =>
    onChange(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))

  return (
    <div className="space-y-2">
      <PixelSectionHeader />
      <p className="text-xs text-slate-500 mb-1">Dispare uma conversão conforme o que a pessoa responder:</p>

      {rules.map((rule, i) => {
        const noValue = !VALUE_OPERATORS.includes(rule.condition.operator)
        return (
          <div key={rule.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-500">Quando a resposta…</span>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
                onClick={() => onChange(rules.filter((_, idx) => idx !== i))}>
                <X className="w-3 h-3 text-red-400" />
              </Button>
            </div>
            <select
              value={rule.condition.operator}
              onChange={(e) => update(i, { condition: { ...rule.condition, operator: e.target.value as PixelEventRule['condition']['operator'] } })}
              className="w-full text-sm rounded-md border px-2 py-1.5 bg-white text-slate-800"
            >
              {Object.entries(OPERATOR_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            {!noValue && (
              <Input
                value={rule.condition.value}
                onChange={(e) => update(i, { condition: { ...rule.condition, value: e.target.value } })}
                placeholder="valor" className="text-sm"
              />
            )}
            <div className="flex items-center gap-1.5 text-xs text-slate-500"><Target className="w-3 h-3" /> dispara</div>
            <EventPicker event={rule.event} onChange={(ev) => update(i, { event: ev ?? defaultEvent() })} />
          </div>
        )
      })}

      <Button variant="outline" size="sm" className="w-full text-xs text-slate-700"
        onClick={() => onChange([...rules, { id: genId(), condition: { operator: 'equals', value: '' }, event: defaultEvent() }])}>
        <Plus className="w-3 h-3 mr-1" /> Adicionar conversão
      </Button>
    </div>
  )
}

// ── Editor de conversões (entrada principal) ────────────────────────────────
export function PixelBranchingEditor({ question, onChange, hasPixelPlan }: PixelBranchingEditorProps) {
  if (!hasPixelPlan) {
    return (
      <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 opacity-70">
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-medium text-slate-500">Conversões (Pixel)</span>
          <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Plus+</span>
        </div>
        <p className="text-xs text-slate-400 mt-1">Disponível nos planos Plus e Professional.</p>
        <a href="/billing" className="text-xs text-blue-500 hover:underline mt-1 inline-block">Fazer upgrade →</a>
      </div>
    )
  }

  const rules = question.pixelEvents ?? []

  // Blocos de conteúdo — um único evento
  if (question.type === 'content_block' || question.type === 'html_block') {
    return (
      <div className="space-y-2">
        <PixelSectionHeader />
        <p className="text-xs text-slate-500 mb-1">Ao chegar neste bloco, disparar:</p>
        <EventPicker event={getBlockEvent(rules)} onChange={(ev) => onChange(setBlockEvent(rules, ev))} />
      </div>
    )
  }

  // Perguntas de escolha — uma linha por resposta
  if (isChoiceType(question.type)) {
    const opts = answerOptions(question)
    const extra = unhandledPixelRules(rules, question)
    return (
      <div className="space-y-2">
        <PixelSectionHeader />
        <p className="text-xs text-slate-500 mb-1">Qual evento cada resposta dispara:</p>
        {opts.length === 0 ? (
          <p className="text-xs text-slate-400 italic">Adicione opções de resposta para definir as conversões.</p>
        ) : (
          <div className="space-y-2">
            {opts.map((opt, i) => (
              <div key={i} className="rounded-xl border-2 border-slate-200 p-2.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <AnswerChip type={question.type} index={i} label={opt} />
                  <ArrowRight className="w-3.5 h-3.5 text-slate-300" />
                </div>
                <EventPicker
                  event={getAnswerEvent(rules, opt)}
                  onChange={(ev) => onChange(setAnswerEvent(rules, question, opt, ev))}
                />
              </div>
            ))}
          </div>
        )}
        {extra.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 space-y-1">
            <p className="text-[11px] font-semibold text-amber-700">Conversões avançadas (não ligadas a uma opção)</p>
            {extra.map(r => (
              <div key={r.id} className="flex items-center justify-between text-[11px] text-amber-800">
                <span>{r.condition.operator} “{r.condition.value}” → {r.event?.name}</span>
                <Button variant="ghost" size="sm" className="h-5 w-5 p-0"
                  onClick={() => onChange(rules.filter(x => x.id !== r.id))}>
                  <X className="w-3 h-3 text-red-400" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Perguntas abertas
  return <OpenPixel rules={rules} onChange={onChange} />
}
