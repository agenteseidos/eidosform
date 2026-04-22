## Handoff — Zéfa (Auditoria) — 2026-04-22 ~02:10 GMT-3

### O que foi feito
Auditoria completa do commit `ad9cdcb` — fluxo de checkout + expiração de plano.

### Bugs encontrados

#### P1-01: Inconsistência tripla de preços (UI × plan-limits × Asaas)
- **Arquivo:** `components/billing-plans.tsx` (linhas com `price:`), `lib/plan-limits.ts` (`yearlyPrice`), `lib/asaas.ts` (`PLAN_PRICES`)
- **Descrição:** Três fontes de verdade com valores conflitantes para preço anual:
  - **UI** (`billing-plans.tsx`): Starter R$29/mês anual → R$348/ano ✅ (bate com Asaas)
  - **plan-limits.ts**: Starter `yearlyPrice: 39.2` → R$470,40/ano ❌ (não bate com nada)
  - **Asaas** (`asaas.ts`): Starter `yearly: 348.0` → R$348/ano ✅
  - Mesma inconsistência para Plus (UI R$97/mês = R$1.164/ano ✅ vs plan-limits R$101,6/mês = R$1.219/ano ❌)
  - E Professional (UI R$197/mês = R$2.364/ano ✅ vs plan-limits R$205,6/mês = R$2.467/ano ❌)
- **Impacto real:** O webhook usa `PLAN_PRICES` do `asaas.ts` para detectar plano pelo valor → funciona corretamente. A UI usa preços hardcoded no `billing-plans.tsx` → mostra preço correto. O `plan-limits.ts` tem `yearlyPrice` errado mas não é usado em lugar nenhum para cobrança — é só metadata. Portanto **não quebra o fluxo de pagamento**.
- **Risco:** Se alguém usar `plan-limits.ts` como fonte de verdade no futuro, vai cobrar errado.
- **Sugestão de fix:** Unificar preços em uma única fonte de verdade (idealmente `asaas.ts`). Remover `yearlyPrice` e `monthlyPrice` de `plan-limits.ts` ou sincronizar com `asaas.ts`.

#### P2-01: `plan_expires_at` e `responses_used` não resetados no PAYMENT_OVERDUE
- **Arquivo:** `app/api/webhooks/asaas/route.ts`, linhas ~150-159
- **Descrição:** No handler `PAYMENT_OVERDUE`, o update reverte `plan` pra free e `responses_limit` pra 100, mas **não reseta** `plan_expires_at` para `null` e `responses_used` para `0`. O handler `SUBSCRIPTION_DELETED` faz ambos corretamente.
- **Impacto:** Plano expirado continua com `plan_expires_at` preenchido. O `/api/user/plan-features` pode tentar reverter de novo desnecessariamente. O `responses_used` permanece com valor antigo em vez de resetar.
- **Sugestão de fix:** Adicionar `plan_expires_at: null` e `responses_used: 0` ao update do PAYMENT_OVERDUE:
  ```ts
  await supabase
    .from('profiles')
    .update({
      plan: 'free',
      plan_status: 'overdue',
      plan_expires_at: null,        // ← adicionar
      responses_used: 0,             // ← adicionar
      limit_alert_sent: false,
      responses_limit: PLANS.free.maxResponses,
    })
    .eq('id', user.id)
  ```

#### P2-02: Texto hardcoded "Ciclo reinicia em 1 de abril"
- **Arquivo:** `app/(dashboard)/billing/page.tsx`, linha ~45
- **Descrição:** Texto `"Ciclo reinicia em 1 de abril"` está hardcoded. Deveria ser dinâmico baseado no `plan_expires_at` do profile ou na data de início do ciclo.
- **Impacto:** Mostra informação incorreta para todos os usuários após abril.
- **Sugestão de fix:** Usar `plan_expires_at` do profile para calcular e exibir a data correta.

#### P2-03: `alreadySubscribed` só verifica plano igual, ignora ciclo diferente
- **Arquivo:** `app/api/checkout/[plan]/route.ts`, linhas ~49-54
- **Descrição:** A verificação `if (profile.asaas_subscription_id && profile.plan === plan)` só bloqueia se o plano for igual. Se o usuário tem Starter mensal e tenta assinar Starter anual, passa direto — cancela a assinatura mensal e cria nova anual. Isso pode ser intencional (upgrade/downgrade de ciclo), mas não há aviso claro ao usuário.
- **Impacto:** Menor — comportamento possivelmente correto, mas merece confirmação.

### Código revisado sem bugs

1. **`asaas_customer_id` no checkout** ✅ — Lógica correta: cria customer se não existe, salva no profile, usa o ID no checkout hospedado.
2. **Expiração por ciclo no webhook** ✅ — `calculateExpiryDate` usa 30 dias (mensal) e 365 dias (anual). Correto.
3. **Reversão automática no plan-features** ✅ — Verifica expiração, reverte pra free com service role client, loga apropriadamente.
4. **CheckoutSuccessOverlay** ✅ — Modal bem construído com AnimatePresence, limpa URL via replaceState, Suspense boundary correto na billing page.
5. **Detecção de plano por valor no webhook** ✅ — `detectPlanAndCycle` compara valor pago com PLAN_PRICES. Fallback por descrição é sensato.
6. **Página de checkout intermediária** ✅ — Loading state, error state, already subscribed state. Redireciona para URL do Asaas corretamente.

### Teste no browser
- `eidosform.com` está apontando para Squarespace (placeholder "under construction"). DNS não configurado para Vercel.
- App funcional em `eidosform.vercel.app` — redireciona corretamente para `/login` quando não autenticado.
- Não foi possível testar fluxo completo de checkout sem credenciais de autenticação.

### Resumo
- **P0:** 0 (zero bugs críticos)
- **P1:** 1 (inconsistência de preços — não quebra fluxo atual, mas risco futuro)
- **P2:** 3 (minor: missing resets no overdue, texto hardcoded, verificação de ciclo)

### Arquivos alterados
- `/home/sidney/eidosform/handoff.md` — este arquivo

### Estado atual
- Commit `ad9cdcb` está deployado e funcional em `eidosform.vercel.app`
- Fluxo de checkout está estruturalmente correto
- Bugs P2 são melhorias que devem ser endereçadas em próxima sprint

### Pendências
- Fix P2-01 (overdue sem reset) — rápido, 2 linhas
- Fix P2-02 (texto hardcoded) — requer trazer `plan_expires_at` no select do billing
- Fix P1-01 (preços duplicados) — refatorar para fonte única de verdade
- DNS: `eidosform.com` precisa apontar para Vercel (atualmente em Squarespace)
- Teste E2E com usuário autenticado em sandbox

### Próximo passo sugerido
- Toin: aplicar fixes P2-01 e P2-02 (rápidos)
- Discutir P1-01 com Sidney antes de refatorar (decisão de arquitetura)
