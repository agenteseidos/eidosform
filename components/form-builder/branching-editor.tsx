'use client'

import { QuestionConfig } from '@/lib/database.types'
import { JumpRule, JUMP_OPERATORS } from '@/lib/jump-logic'
import {
  DEST_NEXT, DEST_SUBMIT, type Destination, genId,
  isChoiceType, answerOptions,
  getAnswerDestination, setAnswerDestination, unhandledRules,
  getBlockDestination, setBlockDestination,
} from '@/lib/branching'
import { renderTiptapHtml } from '@/components/ui/tiptap/TiptapEditor'
import { renderContentBlockHtml } from '@/lib/content-block'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Split, ArrowRight, Flag, X, Plus } from 'lucide-react'

interface BranchingEditorProps {
  question: QuestionConfig
  allQuestions: QuestionConfig[]
  onChange: (rules: JumpRule[]) => void
}

/** Texto curto para identificar uma pergunta no seletor de destino. */
function questionLabel(q: QuestionConfig): string {
  const truncate = (s: string) => (s.length > 44 ? s.slice(0, 44).trimEnd() + '…' : s)
  if (q.title?.trim()) return truncate(q.title.trim())
  if (q.type === 'content_block' || q.type === 'html_block') {
    const raw = q.type === 'content_block' ? q.contentBody : q.htmlBlockNote
    const text = renderTiptapHtml(raw, renderContentBlockHtml)
      .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
    return text ? '▢ ' + truncate(text) : '▢ Bloco de conteúdo'
  }
  return 'Pergunta sem título'
}

// ── Seletor de destino ──────────────────────────────────────────────────────
function DestinationSelect({
  value, others, allowNext = true, onChange,
}: {
  value: Destination
  others: QuestionConfig[]
  allowNext?: boolean
  onChange: (d: Destination) => void
}) {
  const isEnd = value === DEST_SUBMIT
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full text-sm rounded-lg border-2 px-2.5 py-2 bg-white transition-colors ${
        isEnd ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 text-slate-800'
      }`}
    >
      {allowNext && <option value={DEST_NEXT}>→ Próxima pergunta</option>}
      {others.length > 0 && (
        <optgroup label="Ir para a pergunta">
          {others.map(q => (
            <option key={q.id} value={q.id}>{questionLabel(q)}</option>
          ))}
        </optgroup>
      )}
      <option value={DEST_SUBMIT}>🏁 Encerrar formulário</option>
    </select>
  )
}

// ── Selo da resposta (bolinha colorida) ─────────────────────────────────────
export function AnswerChip({ type, index, label }: { type: string; index: number; label: string }) {
  let bg = '#64748b', text = String.fromCharCode(65 + index)
  if (type === 'yes_no') {
    if (label === 'Sim') { bg = '#16a34a'; text = 'S' }
    else { bg = '#64748b'; text = 'N' }
  } else {
    bg = '#7c3aed'
  }
  return (
    <span className="flex items-center gap-2 min-w-0">
      <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
        style={{ background: bg }}>{text}</span>
      <span className="text-sm font-semibold text-slate-800 truncate">{label}</span>
    </span>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      <Split className="w-3.5 h-3.5 text-violet-600" />
      <span className="text-xs font-bold uppercase tracking-wide text-violet-600">{children}</span>
    </div>
  )
}

// ── Ramificação de perguntas abertas (texto, número, data…) ─────────────────
function OpenBranching({ question, rules, others, onChange }: {
  question: QuestionConfig
  rules: JumpRule[]
  others: QuestionConfig[]
  onChange: (rules: JumpRule[]) => void
}) {
  const update = (i: number, patch: Partial<JumpRule>) =>
    onChange(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))

  const addRule = () => onChange([...rules, {
    id: genId(),
    condition: { questionId: question.id, operator: 'equals', value: '' },
    action: { type: 'submit' },
  }])

  return (
    <div className="space-y-2">
      <SectionHeader>Ramificação</SectionHeader>
      <p className="text-xs text-slate-500 mb-1">Desvie o fluxo conforme o que a pessoa responder:</p>

      {rules.map((rule, i) => {
        const noValue = rule.condition.operator === 'is_empty' || rule.condition.operator === 'not_empty'
        const dest: Destination = rule.action?.type === 'submit'
          ? DEST_SUBMIT : (rule.action?.targetQuestionId || DEST_SUBMIT)
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
              onChange={(e) => update(i, { condition: { ...rule.condition, operator: e.target.value as JumpRule['condition']['operator'] } })}
              className="w-full text-sm rounded-md border px-2 py-1.5 bg-white text-slate-800"
            >
              {JUMP_OPERATORS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
            </select>
            {!noValue && (
              <Input
                value={rule.condition.value}
                onChange={(e) => update(i, { condition: { ...rule.condition, value: e.target.value } })}
                placeholder="valor"
                className="text-sm"
              />
            )}
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <ArrowRight className="w-3 h-3" /> ir para
            </div>
            <DestinationSelect
              value={dest}
              others={others}
              allowNext={false}
              onChange={(d) => update(i, {
                action: d === DEST_SUBMIT ? { type: 'submit' } : { type: 'jump', targetQuestionId: d },
              })}
            />
          </div>
        )
      })}

      <Button variant="outline" size="sm" onClick={addRule} className="w-full text-xs text-slate-700">
        <Plus className="w-3 h-3 mr-1" /> Adicionar regra
      </Button>
      <p className="text-[11px] text-slate-400 italic">
        Qualquer outra resposta segue para a próxima pergunta.
      </p>
    </div>
  )
}

// ── Editor de ramificação (entrada principal) ───────────────────────────────
export function BranchingEditor({ question, allQuestions, onChange }: BranchingEditorProps) {
  const rules = question.jumpRules ?? []
  const others = allQuestions.filter(q => q.id !== question.id)

  // Blocos de conteúdo — um único destino
  if (question.type === 'content_block' || question.type === 'html_block') {
    return (
      <div className="space-y-2">
        <SectionHeader>Ramificação</SectionHeader>
        <p className="text-xs text-slate-500 mb-1">Depois deste bloco, ir para:</p>
        <DestinationSelect
          value={getBlockDestination(rules)}
          others={others}
          onChange={(d) => onChange(setBlockDestination(rules, question, d))}
        />
      </div>
    )
  }

  // Perguntas de escolha — uma linha por resposta
  if (isChoiceType(question.type)) {
    const opts = answerOptions(question)
    const extra = unhandledRules(rules, question)
    return (
      <div className="space-y-2">
        <SectionHeader>Ramificação</SectionHeader>
        <p className="text-xs text-slate-500 mb-1">Para onde vai cada resposta:</p>

        {opts.length === 0 ? (
          <p className="text-xs text-slate-400 italic">Adicione opções de resposta para definir a ramificação.</p>
        ) : (
          <div className="rounded-xl border-2 border-slate-200 overflow-hidden">
            {opts.map((opt, i) => (
              <div key={i} className={`flex items-center gap-2 p-2.5 ${i > 0 ? 'border-t border-slate-100' : ''}`}>
                <span className="w-[88px] shrink-0"><AnswerChip type={question.type} index={i} label={opt} /></span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                <span className="flex-1 min-w-0">
                  <DestinationSelect
                    value={getAnswerDestination(rules, opt)}
                    others={others}
                    onChange={(d) => onChange(setAnswerDestination(rules, question, opt, d))}
                  />
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-slate-400">
          Cada destino pode ser: a próxima pergunta · outra pergunta · <Flag className="w-3 h-3 inline -mt-0.5" /> encerrar.
        </p>

        {extra.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 space-y-1">
            <p className="text-[11px] font-semibold text-amber-700">Regras avançadas (não ligadas a uma opção)</p>
            {extra.map(r => (
              <div key={r.id} className="flex items-center justify-between text-[11px] text-amber-800">
                <span>{r.condition.operator} “{r.condition.value}” → {r.action?.type === 'submit' ? 'encerrar' : 'outra pergunta'}</span>
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

  // Perguntas abertas — regras em linguagem natural
  return <OpenBranching question={question} rules={rules} others={others} onChange={onChange} />
}
