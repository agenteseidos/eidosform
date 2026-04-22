## Handoff — Zéfa — 2026-04-22 03:00 GMT-3

### O que foi feito
Auditoria rigorosa da implementação de downgrade no repo `/home/sidney/eidosform`. Análise estática completa dos arquivos envolvidos no fluxo downgrade/upgrade/webhook-gating.

### Arquivos auditados
1. `lib/plan-limits.ts` — `handleDowngrade()`, `handleUpgrade()`, `checkResponseLimit()`, `checkFormLimit()`
2. `app/api/v1/forms/[id]/route.ts` — API v1 POST (webhook dispatch com plan gating)
3. `app/api/responses/route.ts` — Rota pública de submissão (webhook dispatch com plan gating)
4. `app/api/webhooks/asaas/route.ts` — PAYMENT_CONFIRMED, PAYMENT_OVERDUE, SUBSCRIPTION_DELETED
5. `app/api/user/plan-features/route.ts` — Expiração automática + downgrade
6. `lib/webhook-dispatcher.ts` — SSRF protection, retry logic
7. `app/f/[slug]/page.tsx` — Formulário público (paused check)
8. `app/(dashboard)/forms/page.tsx` — Dashboard (paused banner + badge)

### Decisões da auditoria

#### handleDowngrade() — Análise da lógica
- ✅ Step 1: Despausa tudo (clean slate) — correto
- ✅ Step 2: Busca apenas published forms — correto
- ✅ Step 3: Conta responses via query direta — correto
- ✅ Step 4: Separa eligible (<100 respostas) de alwaysPaused (>=100) — correto
- ✅ Step 5: Fisher-Yates shuffle para tie-breaking — algoritmo correto
- ✅ Step 6: Mantém primeiros N do eligible, pausa resto — correto
- ✅ Safety check: garante que forms ativos ≤ freeLimit
- ⚠️ P2: Early return quando `publishedForms.length <= freeLimit` NÃO pausa forms com 100+ respostas

#### Webhook gating — Análise
- ✅ `app/api/v1/forms/[id]/route.ts` (API v1): consulta `ownerProfile.plan`, checa `planConfig?.webhooks` antes de dispatch
- ✅ `app/api/responses/route.ts` (público): mesma lógica — consulta `ownerProfile.plan`, checa `ownerPlanConfig?.webhooks`
- ✅ Free e Starter têm `webhooks: false` — webhook nunca dispara nesses planos
- ✅ Plus e Professional têm `webhooks: true` — webhook dispara normalmente
- ✅ Se `form.webhook_url` for null, não tenta dispatch (short-circuit)
- ✅ Nenhum cenário onde webhook premium escapa no free

#### Fluxo upgrade/downgrade — Análise
- ✅ PAYMENT_CONFIRMED → `responses_used: 0` resetado ✅ + `handleUpgrade()` ✅
- ✅ PAYMENT_OVERDUE → `responses_used` NÃO resetado (P1-1 pré-existente, não deste escopo)
- ✅ SUBSCRIPTION_DELETED → `responses_used: 0` resetado ✅ + `handleDowngrade()` ✅
- ✅ plan-features expiry → `responses_used` NÃO resetado (P1-2 pré-existente, não deste escopo)
- ✅ handleUpgrade() despausa todos os forms corretamente

### Bugs P0
**Zero P0.**

### Bugs P1
**Zero P1 novos.** (P1-1 e P1-2 são pré-existentes — não relacionados ao downgrade rigoroso)

### Bugs P2

**P2-novo: handleDowngrade early return não pausa forms com 100+ respostas quando publishedForms ≤ 3**
- Arquivo: `lib/plan-limits.ts`, linha ~319
- Descrição: Se o usuário tem 3 ou menos published forms, a função retorna `{ pausedCount: 0 }` imediatamente. Mas se algum desses forms tem 100+ respostas, ele NÃO é pausado, contrariando a regra "forms com 100+ respostas são SEMPRE pausados no free".
- Cenário: usuário tem 2 published forms, ambos com 150 respostas → downgrade → ambos continuam ativos. Deveriam estar pausados.
- Fix sugerido: Mover a lógica de alwaysPaused para ANTES do early return:
  ```typescript
  // After counting responses, always pause 100+ response forms
  // even if publishedForms.length <= freeLimit
  if (publishedForms.length <= freeLimit) {
    // Still need to check for 100+ response forms
    const formIds = publishedForms.map((f: { id: string }) => f.id)
    const { data: responseCounts } = await supabase
      .from('responses')
      .select('form_id')
      .in('form_id', formIds)
    
    const countMap = new Map<string, number>()
    for (const f of formIds) countMap.set(f, 0)
    if (responseCounts) {
      for (const r of responseCounts) {
        const fid = (r as { form_id: string }).form_id
        countMap.set(fid, (countMap.get(fid) ?? 0) + 1)
      }
    }
    
    const toPause = [...countMap.entries()]
      .filter(([, count]) => count >= responseThreshold)
      .map(([id]) => id)
    
    if (toPause.length > 0) {
      await supabase.from('forms').update({ paused: true }).in('id', toPause)
      return { pausedCount: toPause.length }
    }
    
    return { pausedCount: 0 }
  }
  ```
  Ou mais elegante: remover o early return e deixar a lógica geral lidar com todos os casos.

**P2-existente (CONFIRMADO): Comentário enganoso sobre crypto-quality randomness**
- Arquivo: `lib/plan-limits.ts`, linha ~366
- Descrição: Comentário diz "Shuffle the group [i, j) using crypto-quality randomness" mas usa `Math.random()` que NÃO é crypto-quality. O `Math.random()` é aceitável para este caso (tie-breaking de forms), mas o comentário está errado.
- Fix: Trocar comentário para "Fisher-Yates shuffle for random tie-breaking" (remover claim de crypto-quality), ou trocar `Math.random()` por `crypto.getRandomValues()` se quiser de fato crypto-quality.

**P2-existente (do handoff anterior, reconfirmado):**
- P2-1: Texto hardcoded "Ciclo reinicia em 1 de abril" em billing/page.tsx
- P2-3: yearlyPrice ambíguo (é equivalente mensal, não anual total)

### Observações (não-bug)
- `Math.random()` como desempate é aceitável — não gera problema de segurança nem de justiça perceptível.
- Forms em status `draft` são intencionalmente ignorados no downgrade (só published forms são pausados). Isso é correto — draft forms já não recebem respostas.
- `countPausedForms()` continua exportada mas não usada — dead code.
- Type casts `(f as { paused?: boolean }).paused` no dashboard são code smell (tipo `Form` já tem `paused: boolean`).

### Estado atual
- Fluxo de downgrade: funcional, com P2-novo identificado (100+ responses não pausados com ≤3 published)
- Fluxo de upgrade: funcional ✅
- Webhook gating: funcional ✅ — zero escapes no free
- Forms pausados: bloqueados na submissão ✅ + mensagem pública ✅
- Dashboard: mostra aviso + badge ✅

### Pendências
- P2-novo: early return do handleDowngrade não pausa 100+ response forms (correção simples)
- P2: Comentário crypto-quality (cosmético)
- P1-1, P1-2: responses_used reset no PAYMENT_OVERDUE e plan-features (pré-existentes)
- P2-1, P2-3: hardcoded text e yearlyPrice ambíguo (pré-existentes)

### Próximo passo sugerido
- Corrigir P2-novo (handleDowngrade early return) — refatorar para remover early return e deixar lógica geral cobrir todos os casos
- Toin/Zeca pode corrigir junto com P1-1 e P1-2

## Handoff — Toin — 2026-04-22 03:10 GMT-3

### O que foi feito
- Corrigido o desempate aleatório em `handleDowngrade()` para usar `crypto.getRandomValues()` no Fisher-Yates dentro dos grupos empatados por número de respostas.
- Mantida a lógica de seleção dos 3 formulários elegíveis com menos respostas.
- Rodada verificação rápida com `npm run typecheck || npm run build`.

### Decisões tomadas
- Segui a opção recomendada da auditoria: usar aleatoriedade real via `crypto` em vez de apenas corrigir o comentário.
- Não alterei a lógica de limite/downgrade além do desempate, para manter o escopo cirúrgico.

### Arquivos alterados
- `lib/plan-limits.ts`

### Estado atual
- O desempate entre formulários com mesmo `responseCount` agora usa `crypto.getRandomValues()`.
- A ordenação continua preservando no máximo 3 forms elegíveis ativos.
- `next build` compilou e passou pela etapa de TypeScript, mas falhou depois por ambiente faltando `supabaseUrl` durante page data collection, sem indicar erro introduzido por este fix.

### Pendências
- Continua pendente o P2 levantado pela Zéfa sobre o early return de `handleDowngrade()` não pausar forms com 100+ respostas quando há `publishedForms <= 3`.

### Próximo passo sugerido
- Corrigir o early return do downgrade para que forms com 100+ respostas sejam pausados mesmo quando o total de published forms é menor ou igual ao limite free.

## Handoff — Zéfa — 2026-04-22 03:37 GMT-3

### O que foi feito
- Auditoria ponta a ponta do billing blindado no commit `8d4b0a3`.
- Revisão estática de checkout, billing profile, webhook Asaas, UX de settings/checkout, migration `billing_checkouts`, downgrade rigoroso e premium gating.
- Validação do browser em produção para `/settings`, `/billing` e `/billing?checkout=success`.

### Decisões tomadas
- Classifiquei apenas P0/P1 relacionados ao escopo novo de billing blindado.
- Mantive como observação separada o fato de produção estar servindo uma página externa “under construction”, porque isso bloqueia validação real do fluxo no browser e pode indicar incidente/deploy incorreto.

### Arquivos auditados
- `app/api/checkout/[plan]/route.ts`
- `lib/billing-profile.ts`
- `app/api/webhooks/asaas/route.ts`
- `components/settings/billing-profile-settings.tsx`
- `app/(dashboard)/checkout/[plan]/page.tsx`
- `app/(dashboard)/billing/page.tsx`
- `components/checkout-success-overlay.tsx`
- `app/(dashboard)/settings/page.tsx`
- `supabase/migrations/20260422_billing_checkout_links.sql`
- `lib/plan-limits.ts`
- `app/api/v1/forms/[id]/route.ts`
- `app/api/responses/route.ts`
- `app/api/forms/[id]/route.ts`
- `app/f/[slug]/page.tsx`
- `components/form-player/form-player.tsx`

### Bugs P0
- **P0-1: webhook do Asaas não resolve assinatura por `asaas_subscription_id`, só por `asaas_customer_id`**
  - Arquivo: `app/api/webhooks/asaas/route.ts`
  - Detalhe: `getUserByCustomerId()` ignora `payment.subscription` / `subscription.id` e tenta localizar conta apenas por `billing_checkouts.asaas_customer_id` ou `profiles.asaas_customer_id`. Se o customer tiver múltiplos checkouts históricos, recheckout, troca de plano ou customer reutilizado, o webhook pode cair na conta errada ou numa conta antiga, quebrando upgrade/downgrade e vínculo de assinatura.
  - Impacto: quebra ativação/cancelamento correto, risco direto de aplicar plano na conta errada.
  - Fix sugerido: resolver primeiro por `asaas_subscription_id` quando o webhook trouxer subscription, depois por vínculo de checkout recente e só então por `asaas_customer_id` como fallback final.

### Bugs P1
- **P1-1: `updateCheckoutLink()` falha em marcar checkout pago/cancelado quando o `asaas_subscription_id` ainda não estava salvo**
  - Arquivo: `app/api/webhooks/asaas/route.ts`
  - Detalhe: o primeiro update tenta `eq('asaas_subscription_id', subscriptionId)`. Para checkouts novos, essa coluna normalmente está `NULL`, então não encontra linha. Em seguida o fallback por customer exige `.eq('status', 'pending')`, mas atualiza todas as linhas pendentes daquele customer, não necessariamente o checkout/subscription correto.
  - Impacto: histórico de billing_checkouts pode ficar inconsistente ou sobrescrever vínculo errado em cenários com múltiplos checkouts pendentes do mesmo customer.
  - Fix sugerido: identificar a linha alvo por `checkout_id`/`subscription_id` de forma determinística e, se cair no fallback por customer, limitar à linha mais recente esperada antes de atualizar.

### Bugs P2
- **P2-1: produção em `https://eidosform.com` está servindo página externa “under construction”**
  - Evidência: browser abriu `/settings`, `/billing` e `/billing?checkout=success`, mas recebeu apenas heading `eidosform.com` + texto “We're under construction. Please check back for an update soon.”
  - Impacto: não consegui validar UX real no browser porque o domínio em produção não está entregando a aplicação Next auditada.
  - Fix sugerido: revisar DNS/proxy/deploy do domínio principal antes da próxima validação E2E.
- **P2-2: `components/settings/billing-profile-settings.tsx` valida no cliente só `fullName`**
  - O bloqueio forte está no backend, então não é quebra crítica, mas a UX poderia prevenir mais cedo telefone/CPF/CEP vazios ou inválidos.
- **P2-3: `app/(dashboard)/billing/page.tsx` mantém texto hardcoded `Ciclo reinicia em 1 de abril`**
  - Já conhecido, mas segue inconsistente com billing real.

### Estado atual
- `app/api/checkout/[plan]/route.ts`: bloqueio de campos obrigatórios, uso da conta logada e gravação em `billing_checkouts` estão corretos.
- `lib/billing-profile.ts`: validação e payload para Asaas ficaram corretos no estado atual; diff local em `lib/billing-profile.ts` apenas evita enviar `null` e não introduz bug visível.
- `lib/plan-limits.ts`: downgrade rigoroso segue com zero P0/P1 neste recorte; o P2 anterior sobre forms `100+` com `<=3 published` permanece do handoff anterior.
- Premium gating: código está coerente, com webhooks e pixels bloqueados no free/starter.
- Browser: validação funcional bloqueada porque o domínio auditado não está servindo a app.

### Pendências
- Corrigir resolução de conta no webhook priorizando `asaas_subscription_id`.
- Tornar update de `billing_checkouts` determinístico para evitar atualizar checkout errado do mesmo customer.
- Revisar incidente/deploy do domínio `eidosform.com` para reabrir validação E2E real no browser.

### Próximo passo sugerido
- Zeca corrigir `app/api/webhooks/asaas/route.ts` com lookup prioritário por subscription e update determinístico do vínculo.
- Depois rodar nova auditoria Zéfa com ambiente/browser já apontando para a aplicação real.
