/**
 * Testes lógicos para lib/billing-activation.ts — expiryFromNextDueDate
 * Execute: npx tsx lib/billing-activation.test.ts
 *
 * Foco: a GUARDA DE SEGURANÇA (só aceita data futura) e a convenção fim-de-dia BRT
 * (UTC-3) que evita cortar o acesso do cliente cedo. (P2-7, audit Codex 2026-06-07.)
 */
import { expiryFromNextDueDate } from './billing-activation'

let passed = 0
let failed = 0

function assert(condition: boolean, name: string) {
  if (condition) {
    console.log(`✅ ${name}`)
    passed++
  } else {
    console.log(`❌ ${name}`)
    failed++
  }
}

// Data claramente FUTURA → fim do dia BRT (23:59:59-03:00) = dia seguinte 02:59:59Z.
const fut = expiryFromNextDueDate('2999-12-31')
assert(fut === '3000-01-01T02:59:59.000Z', `data futura → fim do dia BRT em UTC (got ${fut})`)

// GUARDA: data no passado → null (NUNCA expira no passado/hoje).
assert(expiryFromNextDueDate('2000-01-01') === null, 'data passada → null (guarda de futuro)')

// GUARDA: hoje normalmente já passou de 23:59:59 BRT? Não — hoje à meia-noite ainda é
// futuro até o fim do dia BRT. Então usamos uma data passada fixa acima; aqui validamos
// formatos inválidos e nulos.
assert(expiryFromNextDueDate('2026-13-99') === null, 'data com mês/dia inválidos → null')
assert(expiryFromNextDueDate('nao-e-data') === null, 'string não-data → null')
assert(expiryFromNextDueDate('') === null, 'string vazia → null')
assert(expiryFromNextDueDate(null) === null, 'null → null')
assert(expiryFromNextDueDate(undefined) === null, 'undefined → null')
// Formato com hora não é aceito (esperamos só YYYY-MM-DD)
assert(expiryFromNextDueDate('2999-12-31T10:00:00Z') === null, 'formato com hora → null (só YYYY-MM-DD)')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
