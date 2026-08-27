/**
 * O NÚMERO QUE O CLIENTE DIGITA — normalização no caminho do envio.
 *
 * Incidente de 27/08/2026: o dono configurou "83999376704" (formato brasileiro local, sem o 55)
 * no builder. O envio falhou com "Failed to send message" — mensagem que não diz nada — e as 3
 * tentativas seguidas dispararam o alarme de "os ENVIOS estão falhando", como se o transporte
 * estivesse fora do ar. Não estava: dois envios funcionaram nos minutos seguintes.
 *
 * `toWhatsAppDigits` já existia e já tinha teste. Ela simplesmente NÃO era usada no caminho do
 * envio, que fazia só `.replace(/\D/g,'')` e mandava o resto cru.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { toWhatsAppDigits } from './phone'

describe('🛡️ o formato que a pessoa digita naturalmente funciona', () => {
  it('local brasileiro (11 dígitos) ganha o 55 — era exatamente o caso do incidente', () => {
    expect(toWhatsAppDigits('83999376704')).toBe('5583999376704')
  })

  it('fixo/celular antigo (10 dígitos) também', () => {
    expect(toWhatsAppDigits('8333216704')).toBe('558333216704')
  })

  it('quem já digita completo passa intacto', () => {
    expect(toWhatsAppDigits('5583999376704')).toBe('5583999376704')
  })

  it('pontuação não atrapalha', () => {
    expect(toWhatsAppDigits('+55 (83) 99937-6704')).toBe('5583999376704')
  })

  it('fora da faixa devolve vazio — o chamador recusa em vez de mandar lixo', () => {
    expect(toWhatsAppDigits('123')).toBe('')
    expect(toWhatsAppDigits('1234567890123456')).toBe('')
    expect(toWhatsAppDigits(null)).toBe('')
  })
})

describe('🛡️ o caminho do envio REALMENTE usa a normalização', () => {
  const rota = readFileSync(join(__dirname, '..', 'app', 'api', 'whatsapp', 'send', 'route.ts'), 'utf-8')

  it('sendViaVps normaliza em vez de só tirar pontuação', () => {
    expect(rota).toContain('const cleanPhone = toWhatsAppDigits(phone)')
    // A regressão exata: voltar ao replace cru mandaria "83999376704" para o gateway de novo.
    expect(rota).not.toMatch(/const cleanPhone = phone\.replace/)
  })

  it('número fora de faixa vira erro de DADO (400), não falha de transporte (502)', () => {
    expect(rota).toContain('NumeroInvalidoError')
    expect(rota).toContain('Número de WhatsApp inválido')
    expect(rota).toContain('5583999999999')  // o exemplo que ensina o formato certo
  })

  it('o erro genérico deixou de esconder o motivo', () => {
    // "Failed to send message" sozinho não permitia a ninguém — cliente ou dono — descobrir o
    // que houve, porque o motivo real só ia para o console (não retido no plano Hobby).
    expect(rota).toContain('details: msg.slice(0, 200)')
  })
})

describe('🛡️ o gateway também se protege', () => {
  it('recusa destino inválido ANTES de tocar no transporte, sem contar falha', () => {
    const gw = readFileSync(join(__dirname, '..', 'services', 'whatsapp', 'server.js'), 'utf-8')
    expect(gw).toContain('function normalizarDestino')
    expect(gw).toContain('Invalid destination number')
    // A guarda tem que vir ANTES de qualquer envio DENTRO do handler — senão o alarme conta
    // assim mesmo. (Recorta o handler: `performSend` também é chamado em outros pontos do
    // arquivo, e comparar índices no arquivo inteiro comparava trechos sem relação.)
    const handler = gw.slice(gw.indexOf("fastify.post('/api/whatsapp/send'"))
    expect(handler.indexOf('normalizarDestino(toBruto)')).toBeLessThan(handler.indexOf('performSend'))
  })
})
