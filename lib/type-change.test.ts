/**
 * E06-S1-002 — trocar o tipo da pergunta não pode apagar o trabalho do dono.
 *
 * `handleTypeChange` espalhava o `defaultConfig` do tipo novo por cima da pergunta, e o
 * defaultConfig dos tipos de escolha traz `options: ['Opção 1','Opção 2','Opção 3']`. Trocar
 * "múltipla escolha" por "seleção" APAGAVA 20 alternativas escritas à mão e devolvia as
 * genéricas — sem aviso e sem desfazer.
 */
import { describe, it, expect } from 'vitest'
import { buildTypeChangeUpdates, CHOICE_TYPES } from './questions'

const MINHAS = ['Psicanálise', 'Gestalt', 'TCC', 'Junguiana']

describe('troca entre tipos de ESCOLHA — as opções são do dono', () => {
  it('dropdown → select preserva as opções escritas à mão', () => {
    const u = buildTypeChangeUpdates({ type: 'dropdown', options: MINHAS }, 'select')
    expect(u.type).toBe('select')
    expect(u.options).toEqual(MINHAS)
  })

  it('select → checkboxes preserva', () => {
    expect(buildTypeChangeUpdates({ type: 'select', options: MINHAS }, 'checkboxes').options).toEqual(MINHAS)
  })

  it('checkboxes → dropdown preserva', () => {
    expect(buildTypeChangeUpdates({ type: 'checkboxes', options: MINHAS }, 'dropdown').options).toEqual(MINHAS)
  })

  it('preserva por CÓPIA — mexer no resultado não altera a pergunta original', () => {
    const original = { type: 'dropdown' as const, options: [...MINHAS] }
    const u = buildTypeChangeUpdates(original, 'select')
    ;(u.options as string[]).push('Intrusa')
    expect(original.options).toEqual(MINHAS)
  })

  it('sem opções (lista vazia) cai no default do tipo novo — não há o que preservar', () => {
    const u = buildTypeChangeUpdates({ type: 'dropdown', options: [] }, 'select')
    expect((u.options ?? []).length).toBeGreaterThan(0)
  })
})

describe('troca ENTRANDO ou SAINDO de escolha', () => {
  it('texto → dropdown recebe o default (não havia nada do dono)', () => {
    const u = buildTypeChangeUpdates({ type: 'short_text', options: undefined }, 'dropdown')
    expect((u.options ?? []).length).toBeGreaterThan(0)
  })

  it('dropdown → texto LIMPA as opções (não fazem sentido lá)', () => {
    const u = buildTypeChangeUpdates({ type: 'dropdown', options: MINHAS }, 'short_text')
    expect(u.options).toBeUndefined()
  })

  it('nenhum tipo fora da lista de escolha carrega options', () => {
    for (const t of ['short_text', 'email', 'phone', 'date', 'rating', 'nps', 'calendly'] as const) {
      expect(buildTypeChangeUpdates({ type: 'dropdown', options: MINHAS }, t).options).toBeUndefined()
    }
  })

  it('a lista de tipos de escolha é exatamente a esperada', () => {
    expect([...CHOICE_TYPES].sort()).toEqual(['checkboxes', 'dropdown', 'select'])
  })
})
