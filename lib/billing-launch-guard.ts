/**
 * lib/billing-launch-guard.ts — KILL-SWITCH de emergência do billing.
 *
 * Histórico: nasceu como trava de lançamento (BILLING_MVP_ONLY default ON) enquanto os fluxos de
 * troca de plano editavam valor de assinatura — o Asaas de PRODUÇÃO bloqueia isso (400
 * invalid_value). Em 2026-06-10 o redesenho cancelar+recriar via token substituiu TODOS esses
 * fluxos (nenhum caminho edita valor de sub) e a oferta foi liberada por inteiro: todos os planos,
 * mensal e anual, upgrade/downgrade. Decisão Sidney 2026-06-10: código alinhado p/ venda 100%,
 * sem rollout gradual.
 *
 * A trava permanece como KILL-SWITCH: setar BILLING_MVP_ONLY=true numa emergência volta ao modo
 * restrito (só primeira compra mensal dos ALLOWED_PLANS; mudança de plano → 409) sem deploy.
 */
const MVP_ONLY = process.env.BILLING_MVP_ONLY === 'true' // OFF por padrão (kill-switch)
// Planos permitidos p/ primeira compra QUANDO o kill-switch está ON (modo restrito de emergência).
const ALLOWED_PLANS = (process.env.BILLING_ALLOWED_PLANS ?? 'starter').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)

/** Fallback de cartão morto: abre checkout DETACHED da diferença quando o token salvo
 *  falha/não existe. OFF por padrão até o E2E de produção passar (inverter depois,
 *  espelhando o histórico do BILLING_MVP_ONLY). Gateia SÓ a criação da sessão — os
 *  caminhos de conclusão (webhook/DLQ/cron) ficam sempre ativos (dinheiro já pago). */
const CARD_FALLBACK = process.env.BILLING_CARD_FALLBACK === 'true'
export function isCardFallbackEnabled(): boolean { return CARD_FALLBACK }

export type LaunchBlock = { status: number; body: { error: string; code: string } }

/** null = checkout permitido no escopo atual; senão o bloqueio (status + body) p/ a rota usar. */
export function checkLaunchScope(params: { currentPlan: string; targetPlan: string; cycle: string }): LaunchBlock | null {
  if (!MVP_ONLY) return null
  const { currentPlan, targetPlan, cycle } = params

  // Modo de emergência: SEM mudança de plano/ciclo p/ quem já é pagante.
  if (currentPlan !== 'free') {
    return { status: 409, body: { error: 'A mudança de plano está temporariamente indisponível. Fale com o suporte.', code: 'PLAN_CHANGE_DISABLED' } }
  }
  // Modo de emergência: só mensal.
  if (String(cycle).toUpperCase() !== 'MONTHLY') {
    return { status: 409, body: { error: 'O plano anual está temporariamente indisponível. Por enquanto, escolha o ciclo mensal.', code: 'CYCLE_NOT_AVAILABLE_YET' } }
  }
  // Só os planos liberados (default: starter) na primeira compra.
  if (!ALLOWED_PLANS.includes(String(targetPlan).toLowerCase())) {
    return { status: 409, body: { error: 'Este plano estará disponível em breve.', code: 'PLAN_NOT_AVAILABLE_YET' } }
  }
  return null
}

/** Estado da trava (p/ a UI esconder opções — defesa secundária; o servidor é a primária). */
export function launchScope(): { mvpOnly: boolean; allowedPlans: string[] } {
  return { mvpOnly: MVP_ONLY, allowedPlans: ALLOWED_PLANS }
}
