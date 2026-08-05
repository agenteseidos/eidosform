/**
 * buildExternalReference / buildPlanChangeReference / parseExternalReference /
 * attemptMatches (lib/asaas.ts) — Vitest (convertido do script-style em 05/08,
 * parecer Codex: os asserts do fix do achado #6 precisam rodar no CI).
 *
 * O externalReference carrega a INTENÇÃO (dono + plano + ciclo) e é a fonte da
 * verdade do webhook pra resolver EXATAMENTE o que foi pago. O formato COMPACTO
 * do planchange (achado #6) existe porque o formato longo com |attempt:<uuid36>
 * estourava o limite do Asaas (100 aceito / 129 recusado, sonda 05/08) e TODO
 * upgrade pago falhava com invalid_externalReference.
 */
import { describe, it, expect } from 'vitest'
import { buildExternalReference, buildPlanChangeReference, parseExternalReference, attemptMatches } from './asaas'

const UUID = '11111111-2222-3333-4444-555555555555'
const ATTEMPT = 'aabbccdd-eeff-0011-2233-445566778899'

describe('buildExternalReference / parse (formato legado de assinatura — intacto)', () => {
  it('round-trip completo', () => {
    const ref = buildExternalReference(UUID, 'plus', 'YEARLY')
    expect(ref).toBe(`profile:${UUID}|plan:plus|cycle:YEARLY`)
    const p = parseExternalReference(ref)
    expect(p).toMatchObject({ profileId: UUID, plan: 'plus', cycle: 'YEARLY' })
  })

  it('só dono → plan/cycle null', () => {
    const p = parseExternalReference(buildExternalReference(UUID))
    expect(p).toMatchObject({ profileId: UUID, plan: null, cycle: null })
  })

  it('robustez: null/vazio/lixo/uuid inválido → null', () => {
    expect(parseExternalReference(null).profileId).toBeNull()
    expect(parseExternalReference('').profileId).toBeNull()
    expect(parseExternalReference('lixo:abc|plan:plus').profileId).toBeNull()
    expect(parseExternalReference('profile:nao-uuid|plan:plus').profileId).toBeNull()
  })

  it('ciclo inválido é ignorado; plano desconhecido é rejeitado (P3)', () => {
    const bc = parseExternalReference(`profile:${UUID}|plan:starter|cycle:WEEKLY`)
    expect(bc).toMatchObject({ profileId: UUID, plan: 'starter', cycle: null })
    const bp = parseExternalReference(`profile:${UUID}|plan:enterprise|cycle:MONTHLY`)
    expect(bp).toMatchObject({ profileId: UUID, plan: null, cycle: 'MONTHLY' })
  })
})

describe('planchange COMPACTO (achado #6 — 05/08)', () => {
  it('build: p:<uuid>|plan:X|c:M|k:pc|a:<12hex>', () => {
    expect(buildPlanChangeReference(UUID, 'plus', 'MONTHLY', ATTEMPT))
      .toBe(`p:${UUID}|plan:plus|c:M|k:pc|a:aabbccddeeff`)
  })

  it('round-trip: c:M→MONTHLY, k:pc→planchange, attempt truncado', () => {
    const p = parseExternalReference(buildPlanChangeReference(UUID, 'plus', 'MONTHLY', ATTEMPT))
    expect(p).toEqual({ profileId: UUID, plan: 'plus', cycle: 'MONTHLY', kind: 'planchange', attempt: 'aabbccddeeff' })
  })

  it('TETO: pior caso (professional/MONTHLY) ≤ 84 chars (maior aceito comprovado)', () => {
    const worst = buildPlanChangeReference(UUID, 'professional', 'MONTHLY', ATTEMPT)
    expect(worst.length).toBeLessThanOrEqual(84)
  })

  it('formato LEGADO (pagamentos de junho) segue parseável', () => {
    const legacy = `profile:${UUID}|plan:plus|cycle:MONTHLY|kind:planchange|attempt:${ATTEMPT}`
    expect(parseExternalReference(legacy))
      .toEqual({ profileId: UUID, plan: 'plus', cycle: 'MONTHLY', kind: 'planchange', attempt: ATTEMPT })
  })

  it('kind/k desconhecidos → null (restrito a planchange/pc)', () => {
    expect(parseExternalReference(`profile:${UUID}|plan:plus`).kind).toBeNull()
    expect(parseExternalReference(`profile:${UUID}|kind:outracoisa`).kind).toBeNull()
    expect(parseExternalReference(`p:${UUID}|k:xx`).kind).toBeNull()
  })
})

describe('attemptMatches (guard de dinheiro do backstop — NUNCA igualdade direta)', () => {
  it('prefixo 12 hex (atual) casa com o UUID cheio', () => {
    expect(attemptMatches('aabbccddeeff', ATTEMPT)).toBe(true)
  })
  it('prefixo 8 hex (histórico do hotfix) segue casando', () => {
    expect(attemptMatches('aabbccdd', ATTEMPT)).toBe(true)
  })
  it('legado: UUID completo = UUID completo', () => {
    expect(attemptMatches(ATTEMPT, ATTEMPT)).toBe(true)
  })
  it('OUTRA tentativa não casa (senão o backstop estornaria pagamento errado)', () => {
    expect(attemptMatches('112233445566', ATTEMPT)).toBe(false)
  })
  it('prefixo curto demais (<8) NUNCA casa — casaria com qualquer tentativa', () => {
    expect(attemptMatches('aabbccd', ATTEMPT)).toBe(false)
  })
  it('ausentes → false', () => {
    expect(attemptMatches(null, ATTEMPT)).toBe(false)
    expect(attemptMatches('aabbccddeeff', null)).toBe(false)
  })
})
