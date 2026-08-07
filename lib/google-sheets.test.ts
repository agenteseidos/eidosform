/**
 * Cabeçalho da planilha do Google (auditoria 2026-08, lote 3 · L3-5).
 *
 * O arquivo já cobria `parseRowIndexFromRange` (bloco no fim), mas `upsertSubmission` — a função
 * que de fato ESCREVE na planilha do cliente — tinha cobertura ZERO. Foi por isso que a análise
 * de risco vetou mexer nela às cegas: um erro aqui não dá 500 em lugar nenhum, corrompe dados de
 * forma silenciosa e permanente.
 *
 * A montagem do cabeçalho foi extraída para `computeSheetHeaders`, uma função pura, justamente
 * para poder ser testada sem chamar a API do Google. O INVARIANTE abaixo é o coração do lote:
 *
 *   numa planilha que já tem dados, o cabeçalho existente é um PREFIXO do novo.
 *
 * Se essa propriedade quebrar, os títulos deslizam sobre as linhas antigas e todo o histórico do
 * cliente passa a mostrar o valor de uma coluna sob o nome de outra.
 */
import { describe, it, expect } from 'vitest'
import { computeSheetHeaders, parseRowIndexFromRange } from './google-sheets'

const UTMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']
const COMPLETA = ['Data/Hora', 'response_id', 'status', 'Qual seu nome?', 'meta_events', ...UTMS]

/** O invariante que impede o desalinhamento do histórico. */
function ehPrefixo(antigo: string[], novo: string[]) {
  return antigo.every((c, i) => novo[i] === c)
}

describe('computeSheetHeaders', () => {
  it('planilha VAZIA recebe a ordem canônica completa', () => {
    const r = computeSheetHeaders([], ['P1', 'P2'])
    expect(r.needsUpdate).toBe(true)
    expect(r.headers).toEqual([
      'Data/Hora', 'nome', 'email', 'telefone', 'response_id', 'status',
      'P1', 'P2', 'meta_events', ...UTMS,
    ])
  })

  it('L3-5: pergunta NOVA vai para o FIM, nunca inserida no meio', () => {
    // Este é o defeito. A versão antiga colocava "Qual sua idade?" ANTES de `meta_events`,
    // empurrando meta_events e as 5 UTMs uma casa para a direita — só na linha 1. Toda resposta
    // já gravada passava a exibir o valor errado sob cada um desses títulos.
    const r = computeSheetHeaders(COMPLETA, ['Qual seu nome?', 'Qual sua idade?'])
    expect(r.needsUpdate).toBe(true)
    expect(ehPrefixo(COMPLETA, r.headers)).toBe(true)
    expect(r.headers[r.headers.length - 1]).toBe('Qual sua idade?')
    expect(r.headers.indexOf('meta_events')).toBe(COMPLETA.indexOf('meta_events'))
  })

  it('L3-5: NENHUMA mudança de formulário move uma coluna existente', () => {
    // Varredura do invariante contra as edições que o cliente realmente faz.
    const cenarios: Array<[string, string[], string[]]> = [
      ['pergunta nova', COMPLETA, ['Qual seu nome?', 'Nova']],
      ['pergunta renomeada', COMPLETA, ['Qual é o seu nome?']],
      ['pergunta removida', COMPLETA, []],
      ['várias novas de uma vez', COMPLETA, ['A', 'B', 'C']],
      ['colunas reordenadas à mão pelo cliente', ['status', 'Data/Hora', 'response_id', 'P1'], ['P1', 'P2']],
      ['planilha legada sem response_id/status', ['Data/Hora', 'P1'], ['P1']],
    ]
    for (const [nome, antes, labels] of cenarios) {
      const r = computeSheetHeaders(antes, labels)
      expect(ehPrefixo(antes, r.headers), `"${nome}" reordenou o cabeçalho`).toBe(true)
    }
  })

  it('pergunta RENOMEADA cria coluna nova e preserva a antiga com o histórico', () => {
    const r = computeSheetHeaders(COMPLETA, ['Qual é o seu nome?'])
    expect(r.headers).toContain('Qual seu nome?')       // dados antigos continuam sob o título antigo
    expect(r.headers).toContain('Qual é o seu nome?')   // respostas novas vão para a coluna nova
  })

  it('planilha legada ganha response_id, status, meta_events e UTMs — todos no fim', () => {
    const antes = ['Data/Hora', 'P1']
    const r = computeSheetHeaders(antes, ['P1'])
    expect(r.needsUpdate).toBe(true)
    expect(r.headers).toEqual(['Data/Hora', 'P1', 'response_id', 'status', 'meta_events', ...UTMS])
  })

  it('NÃO acrescenta nome/email/telefone a planilha existente (campo oculto vira coluna vazia)', () => {
    const r = computeSheetHeaders(['Data/Hora', 'response_id', 'status', 'P1', 'meta_events', ...UTMS], ['P1'])
    expect(r.needsUpdate).toBe(false)
    for (const c of ['nome', 'email', 'telefone']) expect(r.headers).not.toContain(c)
  })

  it('nada a acrescentar = needsUpdate false (não reescreve a linha 1 à toa)', () => {
    // Reescrever o cabeçalho sem necessidade é uma chamada de API e um risco por nada.
    const r = computeSheetHeaders(COMPLETA, ['Qual seu nome?'])
    expect(r.needsUpdate).toBe(false)
    expect(r.headers).toEqual(COMPLETA)
  })

  it('pergunta com o mesmo título de uma coluna especial não duplica a coluna', () => {
    const r = computeSheetHeaders(COMPLETA, ['status', 'utm_source'])
    expect(r.needsUpdate).toBe(false)
    expect(r.headers.filter((h) => h === 'status')).toHaveLength(1)
  })

  it('perguntas com títulos repetidos geram UMA coluna só', () => {
    const r = computeSheetHeaders(COMPLETA, ['Nova', 'Nova', 'Nova'])
    expect(r.headers.filter((h) => h === 'Nova')).toHaveLength(1)
  })

  it('planilha vazia com pergunta homônima de coluna especial não duplica', () => {
    const r = computeSheetHeaders([], ['status', 'P1'])
    expect(r.headers.filter((h) => h === 'status')).toHaveLength(1)
    expect(r.headers).toContain('P1')
  })
})

/**
 * Testes de parseRowIndexFromRange — regressão pega em produção 2026-07-08:
 * a regex antiga (/!\w+(\d+)/) tinha \w+ GULOSO e truncava linhas ≥10
 * ("Respostas!A11:Q11" → 1 em vez de 11). O sheets_row_index errado fazia o
 * update seguinte escrever na LINHA ERRADA da planilha.
 */
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
