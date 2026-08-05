/**
 * Testes de buildExternalReference / parseExternalReference (lib/asaas.ts)
 * Execute: npx tsx lib/asaas-external-ref.test.ts
 *
 * O externalReference carrega a INTENÇÃO (dono + plano + ciclo) e é a fonte da verdade do
 * webhook pra resolver EXATAMENTE o que foi pago. (P1 round 3, audit Codex 2026-06-07.)
 */
import { buildExternalReference, buildPlanChangeReference, parseExternalReference } from './asaas'

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

// kind:planchange — FORMATO COMPACTO (achado #6, 05/08): o formato longo com
// |attempt:<uuid36> estourava o limite do Asaas (invalid_externalReference 400)
// e TODO upgrade pago falhava. Compacto: p:<uuid>|plan:X|c:M|k:pc|a:<hex8>.
const ATTEMPT = 'aabbccdd-eeff-0011-2233-445566778899'
const refPC = buildPlanChangeReference(UUID, 'plus', 'MONTHLY', ATTEMPT)
assert(refPC === `p:${UUID}|plan:plus|c:M|k:pc|a:aabbccdd`, `build planchange compacto (got ${refPC})`)
const ppc = parseExternalReference(refPC)
assert(ppc.profileId === UUID && ppc.plan === 'plus' && ppc.cycle === 'MONTHLY' && ppc.kind === 'planchange' && ppc.attempt === 'aabbccdd', 'parse compacto round-trip (cycle M→MONTHLY, kind pc→planchange)')

// TETO DE TAMANHO: pior caso real (professional/MONTHLY) precisa caber com folga no
// limite do Asaas — 84 chars é o maior comprovadamente aceito em produção (junho).
const worst = buildPlanChangeReference(UUID, 'professional', 'MONTHLY', ATTEMPT)
assert(worst.length <= 84, `pior caso ≤ 84 chars (got ${worst.length}: ${worst})`)

// Compat: formato LEGADO (pagamentos de junho) segue parseável
const legacy = `profile:${UUID}|plan:plus|cycle:MONTHLY|kind:planchange|attempt:${ATTEMPT}`
const pl = parseExternalReference(legacy)
assert(pl.profileId === UUID && pl.plan === 'plus' && pl.cycle === 'MONTHLY' && pl.kind === 'planchange' && pl.attempt === ATTEMPT, 'parse legado intacto')

// attemptMatches: truncado casa com o cheio; legado casa por igualdade; lixo não casa
import { attemptMatches } from './asaas'
assert(attemptMatches('aabbccdd', ATTEMPT), 'attempt truncado (8 hex) casa com o UUID cheio')
assert(attemptMatches(ATTEMPT, ATTEMPT), 'attempt legado (UUID = UUID) casa')
assert(!attemptMatches('11223344', ATTEMPT), 'attempt de OUTRA tentativa não casa')
assert(!attemptMatches(null, ATTEMPT) && !attemptMatches('aabbccdd', null), 'ausentes → false')

assert(parseExternalReference(`profile:${UUID}|plan:plus`).kind === null, 'ref sem kind → kind null')
assert(parseExternalReference(`profile:${UUID}|kind:outracoisa`).kind === null, 'kind desconhecido → null (restrito a planchange)')
assert(parseExternalReference(`p:${UUID}|k:xx`).kind === null, 'k compacto desconhecido → null')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
