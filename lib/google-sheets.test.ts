/**
 * Testes de parseRowIndexFromRange — regressão pega em produção 2026-07-08:
 * a regex antiga (/!\w+(\d+)/) tinha \w+ GULOSO e truncava linhas ≥10
 * ("Respostas!A11:Q11" → 1 em vez de 11). O sheets_row_index errado fazia o
 * update seguinte escrever na LINHA ERRADA da planilha.
 */
import { describe, it, expect } from 'vitest'
import { parseRowIndexFromRange } from './google-sheets'

describe('parseRowIndexFromRange', () => {
  it('linha de um dígito', () => {
    expect(parseRowIndexFromRange('Respostas!A5:Q5')).toBe(5)
  })

  it('REGRESSÃO: linha de dois dígitos não trunca (A11 → 11, não 1)', () => {
    expect(parseRowIndexFromRange('Respostas!A11:Q11')).toBe(11)
    expect(parseRowIndexFromRange('Respostas!A12:Q12')).toBe(12)
  })

  it('linha de três dígitos e coluna dupla', () => {
    expect(parseRowIndexFromRange('Respostas!A123')).toBe(123)
    expect(parseRowIndexFromRange('Respostas!AA25:AB25')).toBe(25)
  })

  it('nome de aba com espaços/aspas (split no último !)', () => {
    expect(parseRowIndexFromRange("'Minha Aba'!B12:AA12")).toBe(12)
  })

  it('entradas inválidas → null', () => {
    expect(parseRowIndexFromRange(null)).toBe(null)
    expect(parseRowIndexFromRange(undefined)).toBe(null)
    expect(parseRowIndexFromRange('')).toBe(null)
    expect(parseRowIndexFromRange('Respostas!')).toBe(null)
  })
})
