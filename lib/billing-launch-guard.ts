/**
 * lib/billing-launch-guard.ts — TRAVA DE SEGURANÇA do escopo de billing em produção.
 *
 * NÃO é gambiarra temporária — é uma FEATURE FLAG permanente. O Asaas de PRODUÇÃO bloqueia alterar
 * o valor de assinatura de cartão já paga (400 invalid_value), o que invalida em prod: upgrade
 * prorateado, downgrade/Caminho D (editam valor) e a auto-correção de valor recorrente. Deixar
 * esses fluxos acessíveis = cobrança errada / desconto eterno (P0, audit Codex 2026-06-09).
 *
 * Enquanto a flag está ON, o servidor SÓ permite: **primeira compra (free→pago) MENSAL** dos planos
 * liberados. Mudança de plano/ciclo p/ usuário pagante → 409. Quando o redesenho (cancelar+recriar
 * via token, pós-tokenização) estiver pronto, setar BILLING_MVP_ONLY=false e os fluxos completos
 * voltam — SEM mexer no código. Fail-closed (ON por padrão).
 */
const MVP_ONLY = process.env.BILLING_MVP_ONLY !== 'false' // ON por padrão
// Planos liberados p/ PRIMEIRA compra no MVP (Codex: só Starter testado em prod). Relaxar via env.
const ALLOWED_PLANS = (process.env.BILLING_ALLOWED_PLANS ?? 'starter').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)

export type LaunchBlock = { status: number; body: { error: string; code: string } }

/** null = checkout permitido no escopo atual; senão o bloqueio (status + body) p/ a rota usar. */
export function checkLaunchScope(params: { currentPlan: string; targetPlan: string; cycle: string }): LaunchBlock | null {
  if (!MVP_ONLY) return null
  const { currentPlan, targetPlan, cycle } = params

  // P0: SEM mudança de plano/ciclo p/ quem já é pagante (upgrade/downgrade/Caminho D quebram em prod).
  if (currentPlan !== 'free') {
    return { status: 409, body: { error: 'A mudança de plano estará disponível em breve. Para alterar agora, fale com o suporte.', code: 'PLAN_CHANGE_DISABLED' } }
  }
  // Anual não testado em produção (Codex P2) → só mensal no MVP.
  if (String(cycle).toUpperCase() !== 'MONTHLY') {
    return { status: 409, body: { error: 'O plano anual estará disponível em breve. Por enquanto, escolha o ciclo mensal.', code: 'CYCLE_NOT_AVAILABLE_YET' } }
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
