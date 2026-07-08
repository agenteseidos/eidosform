/**
 * Testes de lib/autosave-policy.ts — decisões puras do autosave do builder.
 *
 * Contexto (fix 2026-07-08): o autosave antigo (timer de 1500ms keyado no booleano
 * hasUnsavedChanges) disparava em plena digitação e o eco do servidor
 * (setForm(updatedForm)) revertia texto digitado durante o voo do PATCH ("letras
 * comidas"). O builder passou a versionar edições com um contador síncrono (editSeq);
 * estas funções decidem (a) se o eco pode ser aplicado, (b) o delay do debounce por
 * inatividade com teto de espera, (c) se há pendência.
 */
import { describe, it, expect } from 'vitest'
import { shouldApplyEcho, nextAutosaveDelay, hasPendingEdits, nextVersionRef } from './autosave-policy'

describe('shouldApplyEcho', () => {
  it('aplica o eco quando nenhuma edição aconteceu durante o voo', () => {
    expect(shouldApplyEcho(5, 5)).toBe(true)
  })

  it('descarta o eco quando houve UMA edição durante o voo (uma tecla basta)', () => {
    expect(shouldApplyEcho(5, 6)).toBe(false)
  })

  it('descarta o eco quando houve várias edições durante o voo', () => {
    expect(shouldApplyEcho(5, 42)).toBe(false)
  })

  it('caso inicial: formulário recém-aberto, primeiro save sem edições novas', () => {
    expect(shouldApplyEcho(0, 0)).toBe(true)
  })
})

describe('nextAutosaveDelay', () => {
  const IDLE = 4000
  const MAX_WAIT = 30000

  it('primeira edição pendente: espera o idle cheio', () => {
    const t0 = 1_000_000
    expect(nextAutosaveDelay(t0, t0, IDLE, MAX_WAIT)).toBe(IDLE)
  })

  it('digitação contínua re-armando: continua no idle enquanto longe do teto', () => {
    const t0 = 1_000_000
    expect(nextAutosaveDelay(t0 + 10_000, t0, IDLE, MAX_WAIT)).toBe(IDLE)
  })

  it('perto do teto: encurta o delay pro que resta até MAX_WAIT', () => {
    const t0 = 1_000_000
    // 28s de digitação contínua → restam 2s até o teto de 30s
    expect(nextAutosaveDelay(t0 + 28_000, t0, IDLE, MAX_WAIT)).toBe(2000)
  })

  it('teto atingido: dispara imediatamente (delay 0)', () => {
    const t0 = 1_000_000
    expect(nextAutosaveDelay(t0 + 30_000, t0, IDLE, MAX_WAIT)).toBe(0)
  })

  it('teto ultrapassado: nunca devolve delay negativo', () => {
    const t0 = 1_000_000
    expect(nextAutosaveDelay(t0 + 45_000, t0, IDLE, MAX_WAIT)).toBe(0)
  })

  it('fronteira exata idle == teto restante', () => {
    const t0 = 1_000_000
    // 26s decorridos → restam exatamente 4s = idle
    expect(nextAutosaveDelay(t0 + 26_000, t0, IDLE, MAX_WAIT)).toBe(IDLE)
  })
})

describe('hasPendingEdits', () => {
  it('sem pendência quando tudo foi persistido', () => {
    expect(hasPendingEdits(7, 7)).toBe(false)
  })

  it('pendência quando há revisão local à frente da persistida', () => {
    expect(hasPendingEdits(8, 7)).toBe(true)
  })

  it('estado inicial: nada editado, nada pendente', () => {
    expect(hasPendingEdits(0, 0)).toBe(false)
  })

  it('cenário do save manual com timer órfão: timer dispara após tudo salvo → no-op', () => {
    // handleSave persistiu a revisão 12; um timer armado antes dispara depois.
    // A guarda por seq impede o save redundante.
    expect(hasPendingEdits(12, 12)).toBe(false)
  })

  it('cenário da tecla no meio do voo: snapshot 5 persistido, edição 6 pendente', () => {
    // savedSeq avança pro seqAtBuild (5), mas editSeq já está em 6 → segue pendente
    // (o eco foi descartado e o próximo timer salva a revisão 6).
    expect(hasPendingEdits(6, 5)).toBe(true)
  })
})

describe('nextVersionRef', () => {
  it('avança normalmente com respostas em ordem', () => {
    expect(nextVersionRef(10, 11)).toBe(11)
  })

  it('NUNCA regride: resposta velha (V11) chegando depois da nova (V12) é ignorada', () => {
    // Achado da auditoria 2026-07-08: PATCHes fora de ordem devolviam o ref
    // pra trás → expectedVersion defasado → 409 falso no save seguinte.
    expect(nextVersionRef(12, 11)).toBe(12)
  })

  it('version igual é idempotente', () => {
    expect(nextVersionRef(12, 12)).toBe(12)
  })

  it('undefined inicial (form pré-migration) adota o primeiro version válido', () => {
    expect(nextVersionRef(undefined, 7)).toBe(7)
  })

  it('resposta sem version (undefined/null/NaN) preserva o valor atual', () => {
    expect(nextVersionRef(10, undefined)).toBe(10)
    expect(nextVersionRef(10, null)).toBe(10)
    expect(nextVersionRef(10, NaN)).toBe(10)
    expect(nextVersionRef(undefined, undefined)).toBe(undefined)
  })
})
