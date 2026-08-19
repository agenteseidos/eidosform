import { describe, it, expect } from 'vitest'
import { codigoDeTesteValido, VALIDADE_CODIGO_TESTE_H } from './meta-capi'

/**
 * O código de teste do Meta — e por que ele EXPIRA.
 *
 * Contexto (18/08/2026): evento enviado com `test_event_code` aparece na aba "Eventos de teste" na
 * hora, mas **não conta para a otimização de campanha**. Existia uma variável GLOBAL fazendo isso
 * (`META_TEST_EVENT_CODE`), removida hoje: com CAPI por cliente, um código esquecido no ambiente
 * anularia as conversões de TODOS os clientes ao mesmo tempo, sem erro e sem aviso.
 *
 * O código voltou POR FORMULÁRIO — porque sem ele ninguém consegue conferir que configurou certo,
 * nem o Sidney nem os clientes dele. O que impede o mesmo estrago é a EXPIRAÇÃO: esquecer de
 * apagar deixa de ser um problema depois de 3 horas.
 */
const AGORA = Date.parse('2026-08-18T12:00:00Z')
const hAtras = (h: number) => new Date(AGORA - h * 3600_000).toISOString()

describe('codigoDeTesteValido', () => {
  it('aceita código recém-colado', () => {
    expect(codigoDeTesteValido('TEST26835', hAtras(0.5), AGORA)).toBe('TEST26835')
  })

  it('EXPIRA sozinho depois da validade — esquecer de apagar não zera a campanha do cliente', () => {
    expect(codigoDeTesteValido('TEST26835', hAtras(VALIDADE_CODIGO_TESTE_H - 0.1), AGORA)).toBe('TEST26835')
    expect(codigoDeTesteValido('TEST26835', hAtras(VALIDADE_CODIGO_TESTE_H + 0.1), AGORA)).toBeNull()
    expect(codigoDeTesteValido('TEST26835', hAtras(72), AGORA)).toBeNull()
  })

  it('sem carimbo de quando foi colado, não vale', () => {
    // Sem o carimbo não há como expirar — e um código eterno é exatamente o que se quer evitar.
    expect(codigoDeTesteValido('TEST26835', null, AGORA)).toBeNull()
    expect(codigoDeTesteValido('TEST26835', 'nao-e-data', AGORA)).toBeNull()
  })

  it('carimbo no futuro não vale (relógio torto ou payload adulterado)', () => {
    const futuro = new Date(AGORA + 3600_000).toISOString()
    expect(codigoDeTesteValido('TEST26835', futuro, AGORA)).toBeNull()
  })

  it('recusa formato que não é código do Meta', () => {
    for (const lixo of ['', '  ', '26835', 'PROD26835', 'TEST', 'TEST' + 'x'.repeat(30), null, 42]) {
      expect(codigoDeTesteValido(lixo, hAtras(0.1), AGORA)).toBeNull()
    }
  })

  it('tira espaço em volta do que foi colado', () => {
    expect(codigoDeTesteValido('  TEST26835  ', hAtras(0.1), AGORA)).toBe('TEST26835')
  })
})
