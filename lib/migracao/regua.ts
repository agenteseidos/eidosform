import { PLAN_ORDER, type PlanId } from '@/lib/plans'

/**
 * Régua de recomendação de plano a partir das respostas do form de migração.
 * Fonte da verdade dos limites: `lib/plan-definitions.ts` (respostas 100/1.000/5.000/15.000;
 * perguntas 25/50/100/200; forms 3/100/∞/∞; pixels+webhooks Plus; Sheets/Calendly/CPF Starter;
 * domínio+API Professional; Bloco HTML Plus; lógica condicional Free).
 *
 * Funções PURAS (sem I/O) — testáveis isoladamente. O endpoint só as orquestra.
 */

// Normalização leve: colapsa espaços, tira espaços das pontas, minúsculas.
// (NÃO remove acentos — as chaves abaixo já têm o acento exato das opções do form.)
function norm(s: unknown): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

const tierIndex = (p: PlanId): number => PLAN_ORDER.indexOf(p)
function maiorTier(a: PlanId, b: PlanId): PlanId {
  return tierIndex(a) >= tierIndex(b) ? a : b
}

/** Só dígitos + chave canônica BR (remove o 9º dígito quando presente). Espelha `chaveNumero` do bot. */
export function normalizarTelefoneBR(input: unknown): string {
  const d = String(input ?? '').replace(/\D/g, '')
  if (d.startsWith('55') && d.length === 13 && d[4] === '9') return d.slice(0, 4) + d.slice(5)
  return d
}

export function normalizarEmail(input: unknown): string {
  return String(input ?? '').trim().toLowerCase()
}

export type ReguaResultado = { tier: PlanId; flags: string[] }

// [opção exata (minúscula, com acento), tier mínimo, flag opcional]
const TIER_RESPOSTAS: Array<[string, PlanId, string?]> = [
  ['até 100', 'free'],
  ['100 a 1.000', 'starter'],
  ['1.000 a 5.000', 'plus'],
  ['5.000 a 15.000', 'professional'],
  ['mais de 15.000', 'professional', 'acima_do_limite'],
]
const TIER_MAIOR_FORM: Array<[string, PlanId, string?]> = [
  ['até 25', 'free'],
  ['26 a 50', 'starter'],
  ['51 a 100', 'plus'],
  ['mais de 100', 'professional', 'requer_analise'], // 101–200 (ok) ou >200 (acima) → humano confere
]
// recurso (substring minúscula) → tier mínimo
const TIER_RECURSO: Array<[string, PlanId]> = [
  ['pixels', 'plus'],
  ['rastreamento', 'plus'],
  ['webhook', 'plus'],
  ['integraç', 'plus'],
  ['bloco html', 'plus'],
  ['domínio', 'professional'],
  ['agendamento', 'starter'],
  ['calendly', 'starter'],
  ['cpf', 'starter'],
  ['cnpj', 'starter'],
  ['google sheets', 'starter'],
  // "lógica condicional" e "ainda não uso nada disso" → free (não elevam)
]

/**
 * Recomenda o tier mínimo que cobre o uso descrito. tier = MAIOR exigido por qualquer
 * dimensão (free < starter < plus < professional). Casos desconhecidos NÃO caem em free
 * por fallback — geram flag `requer_analise`.
 */
export function recomendarPlano(resp: {
  respostasMes?: unknown
  maiorForm?: unknown
  qtdForms?: unknown
  recursos?: unknown
}): ReguaResultado {
  let tier: PlanId = 'free'
  const flags = new Set<string>()

  const rm = norm(resp.respostasMes)
  const linhaRm = TIER_RESPOSTAS.find(([k]) => rm === k)
  if (linhaRm) {
    tier = maiorTier(tier, linhaRm[1])
    if (linhaRm[2]) flags.add(linhaRm[2])
  } else if (rm) {
    flags.add('requer_analise') // valor presente mas fora das opções conhecidas
  }

  const mf = norm(resp.maiorForm)
  const linhaMf = TIER_MAIOR_FORM.find(([k]) => mf === k)
  if (linhaMf) {
    tier = maiorTier(tier, linhaMf[1])
    if (linhaMf[2]) flags.add(linhaMf[2])
  } else if (mf) {
    flags.add('requer_analise')
  }

  const qf = Number(String(resp.qtdForms ?? '').replace(/\D/g, ''))
  if (Number.isFinite(qf) && qf > 0) {
    if (qf > 3) tier = maiorTier(tier, 'starter')
    if (qf > 10) flags.add('acima_do_beneficio') // política: recriamos até 10/pedido (≠ limite do plano)
  }

  const recursos = Array.isArray(resp.recursos)
    ? resp.recursos
    : resp.recursos
      ? [resp.recursos]
      : []
  for (const r of recursos) {
    const rn = norm(r)
    for (const [k, t] of TIER_RECURSO) if (rn.includes(k)) tier = maiorTier(tier, t)
  }

  return { tier, flags: Array.from(flags) }
}
