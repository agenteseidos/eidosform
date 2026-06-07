/**
 * Testes de buildExternalReference / parseExternalReference (lib/asaas.ts)
 * Execute: npx tsx lib/asaas-external-ref.test.ts
 *
 * O externalReference carrega a INTENÇÃO (dono + plano + ciclo) e é a fonte da verdade do
 * webhook pra resolver EXATAMENTE o que foi pago. (P1 round 3, audit Codex 2026-06-07.)
 */
import { buildExternalReference, parseExternalReference } from './asaas'

let passed = 0
let failed = 0
function assert(cond: boolean, name: string) {
  if (cond) { console.log(`✅ ${name}`); passed++ }
  else { console.log(`❌ ${name}`); failed++ }
}

const UUID = '11111111-2222-3333-4444-555555555555'

// Round-trip completo
const ref = buildExternalReference(UUID, 'plus', 'YEARLY')
assert(ref === `profile:${UUID}|plan:plus|cycle:YEARLY`, `build completo (got ${ref})`)
const p = parseExternalReference(ref)
assert(p.profileId === UUID && p.plan === 'plus' && p.cycle === 'YEARLY', 'parse completo round-trip')

// Só profile (sem plano/ciclo)
const refOwner = buildExternalReference(UUID)
assert(refOwner === `profile:${UUID}`, 'build só dono')
const po = parseExternalReference(refOwner)
assert(po.profileId === UUID && po.plan === null && po.cycle === null, 'parse só dono → plan/cycle null')

// Robustez: nulo/lixo/uuid inválido
assert(parseExternalReference(null).profileId === null, 'null → tudo null')
assert(parseExternalReference('').profileId === null, 'vazio → tudo null')
assert(parseExternalReference('lixo:abc|plan:plus').profileId === null, 'sem profile válido → profileId null')
assert(parseExternalReference('profile:nao-uuid|plan:plus').profileId === null, 'profile uuid inválido → null')

// Ciclo inválido é ignorado (só MONTHLY/YEARLY)
const pBadCycle = parseExternalReference(`profile:${UUID}|plan:starter|cycle:WEEKLY`)
assert(pBadCycle.profileId === UUID && pBadCycle.plan === 'starter' && pBadCycle.cycle === null, 'ciclo inválido → cycle null (plano e dono ok)')

// Ordem dos campos não importa
const pReorder = parseExternalReference(`plan:starter|cycle:MONTHLY|profile:${UUID}`)
assert(pReorder.profileId === UUID && pReorder.plan === 'starter' && pReorder.cycle === 'MONTHLY', 'ordem dos campos indiferente')

// Plano DESCONHECIDO é rejeitado (P3): evita persistir plano inválido
const pBadPlan = parseExternalReference(`profile:${UUID}|plan:enterprise|cycle:MONTHLY`)
assert(pBadPlan.profileId === UUID && pBadPlan.plan === null && pBadPlan.cycle === 'MONTHLY', 'plano desconhecido → plan null (dono e ciclo ok)')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
