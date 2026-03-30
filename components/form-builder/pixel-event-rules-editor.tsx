'use client'

import { useState } from 'react'
import { PixelEventRule, PixelEventConfig } from '@/types/pixel-events'
import { STANDARD_PIXEL_EVENTS, OPERATOR_LABELS, VALUE_OPERATORS } from '@/lib/pixel-events'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, Trash2, ChevronDown, ChevronRight, Zap, Lock } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface PixelEventRulesEditorProps {
  rules: PixelEventRule[]
  onChange: (rules: PixelEventRule[]) => void
  hasPixelPlan: boolean
}

function generateId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now() + Math.random())
}

export function PixelEventRulesEditor({ rules, onChange, hasPixelPlan }: PixelEventRulesEditorProps) {
  const [isOpen, setIsOpen] = useState(rules.length > 0)

  if (!hasPixelPlan) {
    return (
      <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 opacity-60">
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-medium text-slate-500">Eventos Condicionais do Pixel</span>
          <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Plus+</span>
        </div>
        <p className="text-xs text-slate-400 mt-1">Disponível nos planos Plus e Professional.</p>
        <a href="/billing" className="text-xs text-blue-500 hover:underline mt-1 inline-block">Fazer upgrade →</a>
      </div>
    )
  }

  const addRule = () => {
    const newRule: PixelEventRule = {
      id: generateId(),
      condition: { operator: 'equals', value: '' },
      event: { type: 'standard', name: 'Lead' },
    }
    onChange([...rules, newRule])
    setIsOpen(true)
  }

  const updateRule = (id: string, updates: Partial<PixelEventRule>) => {
    onChange(rules.map(r => r.id === id ? { ...r, ...updates } : r))
  }

  const updateCondition = (id: string, field: string, value: string) => {
    const rule = rules.find(r => r.id === id)
    if (!rule) return
    updateRule(id, { condition: { ...rule.condition, [field]: value } })
  }

  const updateEvent = <K extends keyof PixelEventConfig>(id: string, field: K, value: PixelEventConfig[K]) => {
    const rule = rules.find(r => r.id === id)
    if (!rule) return
    updateRule(id, { event: { ...rule.event, [field]: value } })
  }

  const removeRule = (id: string) => {
    onChange(rules.filter(r => r.id !== id))
  }

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 p-3 text-left hover:bg-slate-50 transition-colors"
      >
        {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
        <Zap className="w-4 h-4 text-purple-500" />
        <span className="text-sm font-medium text-slate-700">Eventos Condicionais do Pixel</span>
        {rules.length > 0 && (
          <span className="text-[10px] font-bold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded ml-auto">
            {rules.length} {rules.length === 1 ? 'regra' : 'regras'}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-3 pt-0 space-y-3">
              {rules.map((rule, index) => (
                <motion.div
                  key={rule.id}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="p-3 rounded-lg border border-slate-100 bg-slate-50 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-500">Regra {index + 1}</span>
                    <Button variant="ghost" size="sm" onClick={() => removeRule(rule.id)} className="h-6 w-6 p-0 text-red-400 hover:text-red-600">
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>

                  {/* Condition */}
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-500">Se resposta</Label>
                    <select
                      value={rule.condition.operator}
                      onChange={(e) => updateCondition(rule.id, 'operator', e.target.value)}
                      className="w-full text-sm text-slate-900 border rounded-md px-2 py-1.5 bg-white"
                    >
                      {Object.entries(OPERATOR_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                    {VALUE_OPERATORS.includes(rule.condition.operator) && (
                      <Input
                        value={rule.condition.value}
                        onChange={(e) => updateCondition(rule.id, 'value', e.target.value)}
                        placeholder="ex: Sim"
                        className="text-sm"
                      />
                    )}
                  </div>

                  {/* Event */}
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-500">Disparar evento</Label>
                    <div className="flex gap-2">
                      <select
                        value={rule.event.type}
                        onChange={(e) => updateEvent(rule.id, 'type', e.target.value as 'standard' | 'custom')}
                        className="text-sm text-slate-900 border rounded-md px-2 py-1.5 bg-white"
                      >
                        <option value="standard">Padrão</option>
                        <option value="custom">Customizado</option>
                      </select>
                      {rule.event.type === 'standard' ? (
                        <select
                          value={rule.event.name}
                          onChange={(e) => updateEvent(rule.id, 'name', e.target.value)}
                          className="flex-1 text-sm text-slate-900 border rounded-md px-2 py-1.5 bg-white"
                        >
                          {STANDARD_PIXEL_EVENTS.map(ev => (
                            <option key={ev} value={ev}>{ev}</option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          value={rule.event.name}
                          onChange={(e) => updateEvent(rule.id, 'name', e.target.value)}
                          placeholder="ex: LeadQualificado"
                          className="flex-1 text-sm"
                        />
                      )}
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <Input
                          type="number"
                          value={rule.event.value ?? ''}
                          onChange={(e) => updateEvent(rule.id, 'value', e.target.value ? parseFloat(e.target.value) : undefined)}
                          placeholder="Valor R$ (opcional)"
                          className="text-sm"
                        />
                      </div>
                      <div className="w-20">
                        <Input
                          value={rule.event.currency ?? 'BRL'}
                          onChange={(e) => updateEvent(rule.id, 'currency', e.target.value)}
                          placeholder="BRL"
                          className="text-sm"
                        />
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}

              <Button variant="outline" size="sm" onClick={addRule} className="w-full text-xs text-slate-700">
                <Plus className="w-3 h-3 mr-1" />
                Adicionar regra
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
