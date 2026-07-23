# Plano de implementação — Fallback de cartão morto (2026-07-03, REV FINAL pós-revisão adversarial)

> **O problema**: quando um assinante tenta trocar de plano e o cartão salvo falha (token morto → erro `CHARGE_FAILED`, HTTP 402) ou nem existe (assinante pré-tokenização → `CARD_TOKEN_REQUIRED`, HTTP 409), ele cai numa tela de erro sem saída — não há como pagar a diferença com outro cartão, e a venda morre ali.
> **A solução (decidida em 10/06)**: abrir um checkout hospedado do Asaas de **pagamento único (DETACHED)** cobrando **só a diferença prorateada**; capturar o token do cartão novo a partir do pagamento confirmado; e concluir a troca pelo motor interno já existente (`executePlanSwitch`).
> **A preocupação central do dono**: o desconto NUNCA entra na recorrência — a assinatura nova **sempre nasce no preço CHEIO** (isso é garantido por construção em `lib/plan-switch.ts:141-153` + guard `isExpectedFullPrice` nos 3 caminhos de ativação, e é provado por teste unitário e pelo E2E de produção, seção 5).
> **Gates**: (1) *token-no-avulso* — teste de R$5 com cartão real em produção **EM ANDAMENTO hoje** (se o avulso DETACHED não devolver `creditCardToken`, a feature para e vai pro plano B, seção 7); (2) *correlação* — o Asaas não persiste `externalReference` no checkout hospedado (`lib/asaas.ts:175-178`), então a correlação é feita pelo **ID da sessão de checkout**, salvo no banco ANTES de entregar a URL ao cliente — **resolvido pelo desenho abaixo**.
> **Este documento já incorpora as 5 correções obrigatórias da revisão adversarial** (P0 + P1-A..D) embutidas no desenho — cada ponto corrigido está marcado com 🛡️ e a origem. Onde a revisão corrigiu o desenho original, a revisão venceu.

Repo: `/home/sidney/eidosform` (HEAD 0448fd1). Deploy: `git push origin main` → Vercel auto-build.

---

## 1. Arquitetura do fluxo (o desenho, já corrigido)

### Decisões estruturais fixadas

- **Uma linha só em `billing_checkouts`**: reusa a linha de recuperação existente `planchange-pay-{profileId}` (route.ts:258), com `payment_method: 'plan_switch_fallback'` como discriminador e **coluna nova `asaas_checkout_session_id`** para a correlação. Não criar segunda linha com `checkout_id` = sessão (contaminaria o `resolveBillingContext` da 1ª compra).
- **Status da linha do fallback = `pending`** (nunca `recovering`): o polling exclui `recovering` (status/route.ts:55) e, escondida, a linha `paid` antiga daria falso sucesso no fast-path do overlay.
- **`asaas_subscription_id = null` na linha do fallback** (≠ fluxo token): evita cross-match no `resolveBillingContext` e o alert-storm do slow-path do polling.
- **Correlação em escada** no webhook: (1) `payment.checkoutSession` → coluna nova; (2) `payment.customer` → linha fallback in-flight do profile. 🛡️ **(P0)** Toda ação automática (aplicar OU estornar) exige **identidade forte**: `payment.customer` bate com a linha **E**, se o payment traz `checkoutSession`, ela bate com `asaas_checkout_session_id` da linha. Customer divergente **NUNCA auto-estorna** — vira alerta + DLQ manual (o modo de falha antigo podia estornar pagamento legítimo de outro cliente).
- **Toda a conclusão em `lib/plan-switch.ts`** (`runCardFallbackBackstop`, irmã de `runPlanChangeBackstop`), compartilhada por webhook, reprocessador da DLQ e cron. Adquire o lock `planchange:{profileId}` e chama `executePlanSwitch` direto (lock não-reentrante, plan-switch.ts:16-18 — NÃO delegar a `runPlanChangeBackstop`).
- **Flag `BILLING_CARD_FALLBACK`** gateia SÓ a criação da sessão. Os caminhos de conclusão (webhook/DLQ/cron) ficam sempre ligados: dinheiro já pago tem que ser processado mesmo com a flag desligada.
- **Sessão nova a cada POST** (sem reuso). Pagamento em sessão superseded é tratado pela política de identidade (🛡️ P0: sessão divergente → manual, nunca auto-estorno cego).
- 🛡️ **(P1-B)** **Premissa de recuperação honesta**: a DLQ `failed` NÃO tem retry automático (o `reprocessAllFailed` é endpoint admin **manual**) e o `reconcile-checkouts` roda **1×/hora** no crontab da VPS (o `vercel.json` só agenda `expire-plans`). Como o webhook é o completador PRIMÁRIO do fallback, o passo novo do cron faz backstop **cedo** (a partir de ~15min) e só expira a 90min — pior caso realista de "pago sem troca" ≈ 1h15 (não "próximo tick de 10min", que não existe).

### Caminho feliz

```
1. DETECÇÃO (app/api/checkout/[plan]/route.ts, sob lock planchange:{profileId})
   a) Token AUSENTE (hoje 409 CARD_TOKEN_REQUIRED, route.ts:203-206)
      — só se customerId existe e change.action === 'checkout' (troca paga);
        credit_covered sem token mantém o 200 covered_no_charge atual.
   b) Token MORTO (hoje 402 CHARGE_FAILED, route.ts:343-346)
      — createPaymentWithToken lançou + recheck ok + payment null.
   Flag OFF → comportamento atual (409/402). Flag ON → passo 2.

2. LINHA DE RECUPERAÇÃO ANTES DA SESSÃO
   upsert billing_checkouts (checkout_id = planchange-pay-{profileId}):
     status 'pending', payment_method 'plan_switch_fallback',
     planchange_attempt_id (decidePlanChangeAttempt, mecanismo existente),
     plan/cycle alvo, original_price/proration_credit/final_price,
     asaas_subscription_id NULL, asaas_payment_id NULL,
     asaas_checkout_session_id NULL, last_event 'CARD_FALLBACK_PENDING'.
   Upsert falhou → 500 ANTES de criar sessão (fail-closed, espelha route.ts:292-295).

3. SESSÃO DETACHED no Asaas (createDetachedCheckout, helper novo em lib/asaas.ts)
   POST /checkouts: chargeTypes ['DETACHED'], billingTypes ['CREDIT_CARD'],
   customer = customerId, items[0].value = proration.finalPrice (>0, guard explícito),
   callbacks {origin}/billing?checkout=success|cancelled|expired, minutesToExpire 60.
   Criou → UPDATE da linha: asaas_checkout_session_id = id,
   last_event 'CARD_FALLBACK_CHECKOUT_CREATED'. Se ESTE update falhar → 503 e NÃO
   devolve a URL (sessão órfã expira sozinha; a correlação nunca fica cega).
   Criação da sessão falhou → linha 'cancelled' (CARD_FALLBACK_CREATE_FAILED) + 502.

4. RESPOSTA AO FRONTEND
   200 { status: 'card_fallback', checkoutUrl, checkoutId: sessionId,
         value: finalPrice, reason: 'CHARGE_FAILED'|'CARD_TOKEN_REQUIRED',
         proration, plan, cycle }
   page.tsx: interstitial "cartão salvo falhou → pagar a diferença com outro cartão"
   → window.location.href = checkoutUrl. (Compat: mesmo sem mudar o front, o código
   atual em page.tsx:187-193 já redirecionaria — res.ok + checkoutUrl presente.)

5. CLIENTE PAGA no checkout hospedado (digita cartão novo) → Asaas redireciona
   p/ /billing?checkout=success → overlay existente faz polling de /api/checkout/status.
   Enquanto pende: fast-paths falham (profile ainda no plano velho) e o short-circuit
   novo (payment_method 'plan_switch_fallback' → 'pending') evita o slow-path.

6. WEBHOOK PAYMENT_CONFIRMED/RECEIVED sem payment.subscription
   (webhooks/asaas/route.ts:473-487, DEPOIS do branch kind:planchange, ANTES do throw):
   runCardFallbackBackstop(db, { customerId, paymentId, checkoutSessionId?, source:'webhook' })
     a) Resolve a linha: por asaas_checkout_session_id OU customer→profile→linha fallback
        in-flight. Nada → 'no_match' → throw atual → DLQ (avulso desconhecido preservado).
     b) LOCK planchange:{profileId}; relê profile + linha SOB o lock (anti-TOCTOU,
        espelho de runPlanChangeBackstop:344-349).
     c) GET /payments/{id} FRESCO (status/value/customer/checkoutSession/creditCard) —
        o payload do webhook é só dica de correlação, nunca fonte de verdade.
        Não CONFIRMED/RECEIVED → throw (retry). REFUNDED → noop + linha cancelled.
     d) 🛡️ (P0) IDENTIDADE antes de qualquer ação automática:
        - payment.customer ≠ asaas_customer_id da linha → NUNCA estorna:
          alerta ops + throw → DLQ p/ roteamento MANUAL (pode ser pagamento
          legítimo de outra origem — ex. cobrança manual criada no painel).
        - payment.checkoutSession presente E ≠ asaas_checkout_session_id da linha →
          não aplica NEM estorna: alerta + throw → DLQ manual (fecha o edge de dois
          alvos com diferenças prorateadas coincidentemente iguais e o pagamento
          tardio de sessão superseded).
        - Identidade FORTE = customer bate E (checkoutSession ausente OU igual).
          Só com ela o backstop auto-aplica ou auto-estorna.
     e) 🛡️ (P1-C) Status da linha fora de {pending, paid, cancelled} (ex. 'overdue'
        escrito por caminho genérico) → terminal fail-closed → estorno + alerta.
     f) VALIDA VALOR (só com identidade forte): |value − Number(final_price)| ≤ 0.01.
        Divergiu → ESTORNA + linha 'cancelled' (CARD_FALLBACK_VALUE_MISMATCH) + alerta.
        final_price null/NaN → alerta + throw (manual).
     g) CAPTURA TOKEN do payment (extractCardToken — shape creditCard.creditCardToken).
        Ausente → alerta "ação manual" + throw → DLQ (se o gate 2 falhar em produção,
        aparece exatamente aqui). 🛡️ (P1-A) O token fica em VARIÁVEL LOCAL —
        NÃO é salvo no profile ainda.
     h) executePlanSwitch({ cardToken: tokenNovo, expectedOldSubscriptionId:
        p.asaas_subscription_id ?? null, plan, cycle,
        nextDueDate: nextDueDateAfterFullCycle(cycle), reason: 'card_fallback' })
        → sub NOVA no PREÇO CHEIO (fullPriceOf, plan-switch.ts:141-153), CAS no
        profile, cancel explícito da sub antiga, reconcile de órfãs — tudo existente.
        !ok → throw (retry) com profile.asaas_card_token INTOCADO.
     i) 🛡️ (P1-A) SÓ APÓS o switch ok: salva o token novo em profiles.asaas_card_token
        + linha → status 'paid', asaas_payment_id, 'CARD_FALLBACK_PAID:{paymentId}'.
        (Se salvar antes e o switch falhar transitório, um retry do usuário entraria
        no fluxo token com o cartão novo e cobraria a diferença DE NOVO — e o
        pagamento da sessão ficaria preso na DLQ como 'no_match'. Salvando depois,
        o retry do backstop relê o token do payment fresco a cada tentativa.)

7. POLLING confirma pelo fast-path local (status/route.ts:77-87) — profile já no alvo →
   overlay "Pagamento confirmado!". Zero consulta extra ao Asaas.
```

### Caminho de abandono (não pagou / expirou)

```
- Cliente fecha a página: linha fica 'pending' com session id. Nada cobrado, plano
  intacto (fail-closed por construção).
- Retorno via cancelUrl/expiredUrl → overlay mostra cancelled/expired (fluxo atual).
- CRON reconcile-checkouts (passo novo), 🛡️ (P1-B) DOIS limiares:
  · updated_at < now−15min → consulta pagamento da sessão (findPaymentByCheckoutSession,
    com validação client-side 🛡️ P0; fallback GET /checkouts/{id}) — pago →
    runCardFallbackBackstop (backstop CEDO de webhook perdido/falho); PENDING → aguarda.
  · sem pagamento E updated_at < now−90min → status 'cancelled',
    last_event 'CARD_FALLBACK_EXPIRED'.
  Cadência real do cron: 1×/hora (crontab da VPS) — recuperação pior-caso ≈ 1h15.
- Nova tentativa do mesmo perfil sobrescreve a linha (upsert por checkout_id); pagamento
  tardio na sessão velha → 🛡️ (P0) session mismatch → alerta + DLQ manual (sem estorno cego).
- Pagar DEPOIS de expirar é impossível (o Asaas bloqueia sessão expirada).
```

### Falha pós-pagamento (pagou mas a troca falhou)

```
- executePlanSwitch falhou (CAS, criar sub etc.) → runCardFallbackBackstop LANÇA →
  webhook marca o evento 'failed' na DLQ (catch existente :1146+). 🛡️ (P1-B) O retry
  NÃO é automático: quem re-tenta é o passo novo do cron (a partir de 15min, 1×/h) ou
  o reprocessador admin manual. Idempotente: lock + guards + CAS. Profile.asaas_card_token
  fica intocado até o switch passar 🛡️ (P1-A).
- Casos TERMINAIS estornam na hora (padrão refundAndFlagSuperseded, plan-switch.ts:282-327),
  SEMPRE condicionados a identidade forte 🛡️ (P0): valor divergente; linha terminal
  cancelled; pagamento duplicado (linha paid com asaas_payment_id ≠ este payment);
  status desconhecido na linha 🛡️ (P1-C). Estorno falhou → DLQ 'dead' + alerta.
- Identidade fraca (customer/sessão divergente) → NUNCA estorna: alerta + DLQ manual.
- Estorno manual é sempre seguro: avulso sem troca aplicada.
```

---

## 2. Mudanças de código, arquivo por arquivo

### 2.1 Migration — `supabase/migrations/20260703_billing_checkout_session_id.sql` (NOVO)

Padrão aditivo das 20260615. ⚠️ **Aplicar manualmente no Supabase de produção ANTES do deploy do código que usa a coluna** (a Vercel não aplica migrations — ver seção 6).

```sql
-- Fallback de cartão morto (2026-07-03): a troca de plano paga sem token utilizável abre
-- um checkout hospedado DETACHED cobrando só a diferença. O Asaas NÃO persiste
-- externalReference no checkout hospedado (smoke 2026-06-08), então a correlação do
-- pagamento avulso com a tentativa de troca é feita pelo ID DA SESSÃO, salvo aqui
-- ANTES de a URL ser entregue ao cliente.
ALTER TABLE billing_checkouts
  ADD COLUMN IF NOT EXISTS asaas_checkout_session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_billing_checkouts_session_id
  ON billing_checkouts (asaas_checkout_session_id)
  WHERE asaas_checkout_session_id IS NOT NULL;
```

### 2.2 `lib/billing-launch-guard.ts` — flag

Padrão module-scope da linha 14:

```ts
/** Fallback de cartão morto: abre checkout DETACHED da diferença quando o token salvo
 *  falha/não existe. OFF por padrão até o E2E de produção passar (inverter depois,
 *  espelhando o histórico do BILLING_MVP_ONLY). Gateia SÓ a criação da sessão — os
 *  caminhos de conclusão (webhook/DLQ/cron) ficam sempre ativos (dinheiro já pago). */
const CARD_FALLBACK = process.env.BILLING_CARD_FALLBACK === 'true'
export function isCardFallbackEnabled(): boolean { return CARD_FALLBACK }
```

### 2.3 `lib/asaas.ts` — 3 helpers novos

**a) `createDetachedCheckout`** (após `createCheckout`, ~linha 225). NÃO parametrizar o `createCheckout` existente — o payload DETACHED não tem bloco `subscription`; misturar convida regressão na 1ª compra:

```ts
export async function createDetachedCheckout(params: {
  customerId: string
  value: number
  name: string            // ≤30 chars (limite de item do Asaas)
  description: string
  successUrl: string
  cancelUrl: string
  expiredUrl: string
  externalReference?: string   // defensivo; Asaas não persiste no hosted checkout
  minutesToExpire?: number     // default 60 (janela menor = menos drift de proration)
}): Promise<{ id: string; url: string }>
```

Payload: `{ customer, billingTypes: ['CREDIT_CARD'], chargeTypes: ['DETACHED'], items: [{ name, description, quantity: 1, value }], callback: {...}, minutesToExpire: params.minutesToExpire ?? 60 }`; retorno igual ao `createCheckout` (asaas.ts:221-223). **A shape exata do payload é validada no smoke de hoje** — se o Asaas exigir `value` no topo, ajustar aqui e só aqui.

**b) `getPaymentWithCard`** (ao lado de `getPaymentById`, ~linha 330): GET `/payments/{id}` devolvendo `{ ok, payment: { id, status, value, customer, checkoutSession, creditCardToken } | null }` — token via `extractCardToken(data)` (asaas.ts:442-445). Mesma semântica ok/404 do `getPaymentById` (asaas.ts:319-330).

**c) `findPaymentByCheckoutSession`** (padrão de `findPaymentByExternalReference`, asaas.ts:337-356): GET `/payments?checkoutSession={id}&limit=10`, filtra CONFIRMED/RECEIVED/PENDING. 🛡️ **(P0-b)** **Validação client-side obrigatória**: descartar todo payment cujo `checkoutSession !== id` — APIs REST (Asaas incluso) costumam **ignorar query params desconhecidos e devolver a listagem geral da conta**; sem esse filtro o cron poderia pegar o pagamento de OUTRO cliente e o backstop estornaria uma renovação legítima. O smoke testa também **id INEXISTENTE → lista vazia** (não só "o filtro aceita o param"). Se o filtro não for suportado, o cron usa `GET /checkouts/{id}` (status da sessão) — deixar comentário com o achado do smoke.

### 2.4 `lib/card-fallback.ts` (NOVO) — criação da sessão (testável isolada)

```ts
export async function openCardFallbackCheckout(db: SupabaseClient, params: {
  profileId: string; customerId: string
  currentSubscriptionId: string | null      // só p/ log — a linha grava NULL
  plan: PlanId; cycle: BillingCycle
  attemptId: string
  proration: { credit: number; originalPrice: number; finalPrice: number }
  origin: string
  reason: 'CHARGE_FAILED' | 'CARD_TOKEN_REQUIRED'
}): Promise<
  | { ok: true; checkoutId: string; checkoutUrl: string }
  | { ok: false; status: number; error: string; code: string }>
```

Executa os passos 2-3 da arquitetura (upsert fail-closed → `createDetachedCheckout` → update do session id fail-closed). Guard interno `finalPrice <= 0 → { ok:false, 400 }` (defensivo). Logs no padrão `[card-fallback]`.

### 2.5 `app/api/checkout/[plan]/route.ts` — os dois pontos de encaixe

- **Imports**: `openCardFallbackCheckout` e `isCardFallbackEnabled`.
- **Hoist do origin** (~linha 179): extrair as linhas 489-498 (allowlist + successUrl/cancelUrl/expiredUrl) para função local `resolveCallbackOrigin(req)` usada pelos dois blocos (fallback e 1ª compra).
- **Site 1 — token ausente (linhas 188-207)**: manter os early-returns de `credit_covered` sem token (200 covered_no_charge) e de `!customerId` (409 atual — anomalia, sem customer não há sessão). Com `customerId` presente, `!token` e `change.action === 'checkout'`: flag OFF → 409 atual; flag ON → **não retornar** — seguir para o lock (linha 211) com `token = null`. Dentro do `try`, no Caso 2, depois de `decidePlanChangeAttempt` (linha 271) e ANTES do bloco de cobrança: `if (!token) return openCardFallbackCheckout(...)` mapeado p/ NextResponse.
- **Site 2 — CHARGE_FAILED (linhas 340-346)**: no branch "recheck ok e não achou" (linha 339), flag ON → em vez de marcar `cancelled` + 402, chamar `openCardFallbackCheckout` (mesmo `attemptId`; a linha de recuperação do upsert 274-291 será re-upsertada com `payment_method 'plan_switch_fallback'`, `status 'pending'`, session id). Flag OFF → 402 atual intocado.
- **Upsert do fluxo token (linhas 274-291)**: adicionar `asaas_checkout_session_id: null` ao payload — retomada via token NÃO herda session id de fallback abandonado (com null, o pagamento tardio da sessão velha cai em session-mismatch → manual 🛡️ P0).

### 2.6 `lib/plan-switch.ts` — conclusão

- **`PlanSwitchParams.reason`** (linha 46): adicionar `'card_fallback'` à union (vira `PLAN_SWITCH_CARD_FALLBACK` no last_event da linha planswitch, :256).
- **`runCardFallbackBackstop`** (NOVO, ao lado de `runPlanChangeBackstop`, ~linha 440):

```ts
export async function runCardFallbackBackstop(db: SupabaseClient, params: {
  customerId: string
  paymentId: string
  checkoutSessionId?: string | null
  source: 'webhook' | 'reprocess' | 'reconcile'
}): Promise<'no_match' | 'switched' | 'already_applied' | 'refunded_superseded'
          | 'refunded_value_mismatch' | 'refunded_duplicate' | 'externally_refunded'>
// Casos de roteamento MANUAL (customer/sessão divergente, token ausente,
// final_price nulo) LANÇAM com mensagem específica → DLQ.
```

Lógica (espelho estrutural de `runPlanChangeBackstop:329-439`):

1. Resolve a linha SEM lock (precisa do profileId p/ a chave do lock): por `asaas_checkout_session_id` (se veio) senão `profiles.asaas_customer_id = customerId` → linha `planchange-pay-{profileId}`. Linha inexistente OU `payment_method !== 'plan_switch_fallback'` → **`'no_match'`** (chamador mantém o throw→DLQ atual).
2. `acquireLock(planchange:{profileId})` — ocupado → throw (retry via cron/reprocess). RELÊ profile + linha sob o lock.
3. `getPaymentWithCard(paymentId)` — sempre fresco. ok=false → throw. REFUNDED/REFUND_REQUESTED → linha `cancelled` `CARD_FALLBACK_REFUNDED_EXTERNALLY` (se in-flight) → `'externally_refunded'`. Não CONFIRMED/RECEIVED → throw (retry).
4. 🛡️ **(P0) Identidade — gate de TODA ação automática:**
   - `payment.customer !== row.asaas_customer_id` → **NUNCA estorna**: `sendBillingOpsAlert` + throw `CARD_FALLBACK_CUSTOMER_MISMATCH — roteamento manual`.
   - `payment.checkoutSession` presente E `!== row.asaas_checkout_session_id` → não aplica nem estorna: alerta + throw `CARD_FALLBACK_SESSION_MISMATCH — manual`.
   - Identidade forte = customer bate E (checkoutSession ausente OU igual). Só ela libera os passos 5-9.
5. Guards de duplicidade/estado:
   - Linha `paid` com `asaas_payment_id === paymentId` → `'already_applied'` (noop).
   - Linha `paid` com `asaas_payment_id !== paymentId` → estorno (reutilizar/exportar o miolo de `refundAndFlagSuperseded`) → `'refunded_duplicate'`.
   - Linha `cancelled` → tentativa abandonada/expirada → estorno → `'refunded_superseded'`.
   - 🛡️ **(P1-C)** Linha em QUALQUER status fora de {`pending`,`paid`,`cancelled`} (ex. `overdue` gravado por escrita genérica) → terminal fail-closed → estorno + alerta → `'refunded_superseded'`.
   - Profile já no alvo (plan+cycle+sub, espelho :386-392) com linha in-flight → marca `paid` + `asaas_payment_id` → `'already_applied'` (sem estorno — dinheiro legítimo).
6. **Validação de dinheiro**: `fp = Number(row.final_price)`; null/NaN → alerta + throw (manual — P2 coerção NUMERIC, resolvida aqui). `Math.abs(payment.value − fp) > 0.01` → estorno + linha `cancelled` `CARD_FALLBACK_VALUE_MISMATCH:{paymentId}` + alerta → `'refunded_value_mismatch'`.
7. **Token**: `creditCardToken` do payment em **variável local** 🛡️ (P1-A). Ausente → alerta "avulso do fallback pago mas SEM creditCardToken — ação manual" + throw (DLQ; espelho plan-switch.ts:403-409 — o gate 2 falhando em produção aparece aqui).
8. `executePlanSwitch({ db, profileId, customerId: row.asaas_customer_id, cardToken: token, expectedOldSubscriptionId: p.asaas_subscription_id ?? null, plan: row.plan, cycle: row.cycle, nextDueDate: nextDueDateAfterFullCycle(cycle), reason: 'card_fallback', isPlanDowngrade: via PLAN_ORDER (espelho :411-412) })`. `!ok` → throw (retry) — **`profiles.asaas_card_token` INTOCADO** 🛡️ (P1-A).
9. 🛡️ **(P1-A)** Só agora: `update profiles set asaas_card_token = token` + linha → `{ status: 'paid', asaas_payment_id: paymentId, last_event: 'CARD_FALLBACK_PAID:{paymentId}' }` → `'switched'`. (Falha no save do token pós-switch: alerta ops e segue — não-fatal, a sub nova já cobra no cartão novo no Asaas; um futuro planchange cai de novo no fallback, degradação segura.)
10. `finally releaseLock`.

### 2.7 `app/api/webhooks/asaas/route.ts` — gancho de correlação + blindagem

- **Interface `AsaasPayment`** (linhas 292-300): adicionar `checkoutSession?: string`.
- **Branch `!payment?.subscription`** (linhas 473-487): entre o branch `kind:planchange` e o `throw`:

```ts
// Fallback de cartão morto (2026-07-03): avulso DETACHED de sessão de checkout não tem
// subscription NEM externalReference (não persiste). Correlaciona por checkoutSession/customer.
const fb = await runCardFallbackBackstop(getSupabase(), {
  customerId,
  paymentId: String(payment?.id ?? ''),
  checkoutSessionId: (payment as { checkoutSession?: string })?.checkoutSession ?? null,
  source: 'webhook',
})
if (fb !== 'no_match') break
throw new Error(...)  // inalterado: avulso desconhecido continua indo p/ DLQ
```

Erros do backstop propagam pro catch existente (:1146) → DLQ `failed` (retry via cron/reprocess manual 🛡️ P1-B). Sem mudança na auth/idempotência (timingSafeEqual + event_id :324-351).

- 🛡️ **(P1-C) Blindagem da linha do fallback contra escritas genéricas**: `updateCheckoutLink` sem `checkoutLinkId` re-resolve por `resolveBillingContext`, e as opções (2) `customer+plan+cycle+status in (pending,paid)` (route.ts:173-186) e (3) `customer → linha ACTIVEISH mais recente` (:192-213) pegam a linha do fallback (`pending` é ACTIVEISH). O cenário é **correlacionado com a própria feature**: o cartão morto que dispara o fallback é o mesmo que falha a renovação da sub antiga → `PAYMENT_OVERDUE` na janela → `updateCheckoutLink(status:'overdue')` (:886/911) marcaria a linha do fallback `overdue` e/ou sobrescreveria `payment_method` com o billingType (:274) — quebrando o short-circuit do polling (alert-storm) e deixando o backstop em estado indefinido. **Correção**: adicionar `.neq('payment_method','plan_switch_fallback')` às opções (2) e (3) do `resolveBillingContext` e ao re-resolve do `updateCheckoutLink`. (A opção (1), por `asaas_subscription_id`, não casa a linha do fallback — sub é NULL.) A defesa em profundidade do lado do backstop é o guard de status do passo 5 🛡️ (P1-C).

### 2.8 `lib/asaas-reprocess.ts` — retry via DLQ (manual)

No ponto em que hoje recusa pagamento sem `kind:planchange` ("roteamento manual", ~linhas 230-232): antes de recusar, se o evento é PAYMENT_CONFIRMED/RECEIVED com `payment_id` e `customer_id` e sem `subscription_id`, chamar `runCardFallbackBackstop({ customerId, paymentId, checkoutSessionId: null, source: 'reprocess' })` (o backstop busca o payment fresco — a DLQ não guarda value/sessão). `'no_match'` → mantém a recusa atual. 🛡️ (P1-B) Lembrete: este caminho só roda quando alguém dispara o endpoint admin — o completador automático de retaguarda é o cron (2.10).

### 2.9 `app/api/checkout/status/route.ts` — anti-ruído

- Adicionar `payment_method` ao select da linha 51.
- Após os fast-paths (depois da linha 95), antes do slow-path: `if (checkout?.status === 'pending' && checkout?.payment_method === 'plan_switch_fallback') return NextResponse.json({ status: 'pending' })`. Sem isto, o slow-path "única-ativa" (status/route.ts:311-316) elege a sub ANTIGA, o guard de preço-cheio (linha 133) falha e `sendBillingOpsAlert` dispara **a cada tick de 4s** (não há rate-limit no alert; o caso troca-de-ciclo também cai no storm — confirmado na revisão).

### 2.10 `app/api/cron/reconcile-checkouts/route.ts` — filtro no passo existente + passo novo

- 🛡️ **(P1-D)** **Passo EXISTENTE**: adicionar `.neq('payment_method','plan_switch_fallback')` ao SELECT. Confirmado na revisão que sem isso a linha do fallback (status `pending`, `asaas_subscription_id` null) entra no scan, o alvo resolvido vira a sub ANTIGA, `isExpectedFullPrice(valor antigo, plano NOVO)` falha e dispara **alerta falso "PRORATEADO/INSEGURO — manual" a cada execução horária** — fadiga exatamente no alerta que protege contra desconto eterno.
- 🛡️ **(P1-B)** **Passo NOVO** (dois limiares, usando `updated_at` — a linha reusada tem `created_at` antigo): selecionar `payment_method = 'plan_switch_fallback' AND status = 'pending'`:
  - `updated_at < now() − 15min`: `findPaymentByCheckoutSession(asaas_checkout_session_id)` (validado client-side 🛡️ P0-b) → pagamento CONFIRMED/RECEIVED → `runCardFallbackBackstop(..., source: 'reconcile')` (backstop cedo — cobre webhook perdido E evento preso na DLQ `failed`); PENDING → deixa p/ próximo tick.
  - Sem pagamento E `updated_at < now() − 90min` (sessão de 60min + margem): `status 'cancelled'`, `last_event 'CARD_FALLBACK_EXPIRED'`.
  - Best-effort por linha (erro loga e segue), padrão do cron.

### 2.11 `app/(dashboard)/checkout/[plan]/page.tsx` — frontend

- Tipo `CheckoutResponse`: incluir `status?: string` e `reason?: string`.
- Em `startCheckout`, antes do bloco genérico (linha 187):

```ts
if (res.ok && json.status === 'card_fallback' && json.checkoutUrl) {
  setFallbackInfo({ url: json.checkoutUrl, value: json.value, reason: json.reason })
  setState('card-fallback')
  return
}
```

- Estado/tela nova `card-fallback` (layout do card de erro, tom âmbar, sem emoji de erro): título "Seu cartão salvo não funcionou", texto "Não conseguimos cobrar no cartão salvo. Você pode concluir a mudança pagando só a diferença (R$ {value}) com outro cartão — o novo cartão fica salvo para as próximas cobranças.", botão primário "Pagar com outro cartão" (`window.location.href = url`), secundário "Voltar ao billing".
- Sem NENHUMA mudança no front o fluxo já funciona (page.tsx:187-193 redireciona quando `checkoutUrl` vem com 200) — o interstitial é a UX correta porque o usuário esperava cobrança no cartão salvo. O retorno pós-pagamento reusa o overlay existente sem mudança.

---

## 3. Edge cases e como cada um é tratado

| Caso | Tratamento | Origem |
|---|---|---|
| **Dupla troca concorrente** | POST simultâneo → lock `planchange:{profileId}` → 409 (route.ts:212-217, inalterado). Webhook concorrente com POST síncrono → lock → throw → cron/reprocess re-tenta → `already_applied`. | design |
| **Dupla troca sequencial (sessão superseded paga tarde)** | Upsert sobrescreve a linha/session id; pagamento da sessão velha → `checkoutSession` do payment ≠ linha → **alerta + DLQ manual** (nunca auto-estorno cego; fecha também o edge de valores prorateados coincidentes entre alvos ≠). | 🛡️ revisão (P0-c) |
| **Pagamento de TERCEIRO/legítimo alcançando o backstop** (filtro de listagem ignorado pela API; cobrança manual do painel p/ o mesmo customer) | Duas defesas: `findPaymentByCheckoutSession` valida client-side `checkoutSession === id` (filtro ignorado → lista vazia); customer-mismatch **NUNCA auto-estorna** → alerta + DLQ manual. | 🛡️ revisão (P0-a/b) |
| **Retry do usuário após switch falhar pós-pagamento** | Token só entra no profile APÓS o switch ok — o retry do POST NÃO encontra token novo, não recobra; o pagamento original é concluído pelo cron/reprocess (backstop relê o token do payment fresco). | 🛡️ revisão (P1-A) |
| **`PAYMENT_OVERDUE` da sub antiga na janela do fallback** (cartão morto = renovação falhando; cenário correlacionado) | Linha do fallback excluída do `resolveBillingContext`/`updateCheckoutLink` genéricos; e o backstop trata status desconhecido como terminal fail-closed (estorno+alerta, com identidade forte). | 🛡️ revisão (P1-C) |
| **Pagou e o webhook falhou/atrasou/perdeu** | Cron 1×/h com backstop a partir de 15min de idade da linha → pior caso ≈ 1h15 (overlay desiste em 4min; o usuário vê o plano trocado no /billing depois). DLQ `failed` é retry MANUAL (endpoint admin) — a retaguarda automática é o cron. | 🛡️ revisão (P1-B) |
| **Pagou depois de expirar** | Impossível (Asaas bloqueia sessão expirada). Corrida rara pagamento-válido × cron-expirou: linha `cancelled` → estorno `refunded_superseded` + alerta (identidade forte). Dinheiro nunca fica retido sem troca. | design |
| **Pagamento duplicado** (2 sessões pagas p/ mesma tentativa) | 1º aplica e grava `asaas_payment_id`; 2º com session id igual à linha → `refunded_duplicate`; com session id ≠ (superseded) → manual (P0). Webhook duplicado do MESMO payment → idempotência por event_id (:324-351) + `already_applied`. | design + revisão (P0) |
| **Webhook × polling** | Polling é read-only p/ o fallback (short-circuit 2.9 devolve `pending`); único escritor = backstop sob lock + CAS do `executePlanSwitch`. Zero corrida de ativação. | design |
| **Valor divergente** (drift de proration na sessão viva, erro) | Com identidade forte: `|value − final_price| ≤ 0.01` senão estorno + linha cancelled + alerta. A recorrência NUNCA depende do valor pago (sub nasce `fullPriceOf` + guard `isExpectedFullPrice` nos 3 caminhos). Sessão de 60min encolhe a janela de drift. | design |
| **`final_price` null/não-numérico** | `Number()` + null/NaN → alerta + DLQ manual (nunca estorno por coerção ruim). | revisão (P2, resolvido) |
| **Conta pré-tokenização (sem token nenhum)** | Mesma rota — Site 1 (`CARD_TOKEN_REQUIRED`). Exige `customerId` (pagantes via Asaas sempre têm); sem customer → 409 atual. `credit_covered` sem token mantém a mensagem honesta (não há DETACHED de R$0; fora do escopo). | design |
| **Downgrade / diferença ≤ 0** | Fallback SÓ em `change.action === 'checkout'` com `finalPrice > 0` (guard no lib). Downgrades reais caem em `credit_covered` ou `downgrade_scheduled` (early-return :156). `isPlanDowngrade` repassado ao executor (pausa forms excedentes). | design |
| **Estorno externo antes do backstop** | Passo 3 lê REFUNDED → `externally_refunded`, nada aplicado. Estorno DEPOIS da troca = decisão manual (o backstop nunca desfaz troca aplicada); `PAYMENT_REFUNDED` de avulso sem sub → comportamento atual (verificar no smoke que é DLQ/noop e NÃO `buildFreePlanUpdate`). | design |
| **Crash entre criar sessão e responder** | Session id já gravado (antes de devolver a URL); usuário sem URL → sessão expira sem uso; retry do POST cria sessão nova (mesmo attempt via `decidePlanChangeAttempt`). | design |
| **Token novo morre antes da 1ª recorrência** | Fora do escopo: cai no fluxo normal de inadimplência (overdue). O fallback só garante a troca. | design |

---

## 4. O que fica de fora (limitações aceitas / P2s registrados)

1. **Chargeback do avulso DETACHED pós-troca é silencioso** — o handler de chargeback exige sub ativa (webhook route.ts:1060); avulso sem sub → `break`. Mesmo comportamento do avulso do fluxo token hoje; dano limitado à diferença. **Aceito** (alerta dedicado fica p/ depois).
2. **Valor mínimo de cobrança do gateway** — diffs reais podem ser < R$5 (upgrade a dias do fim do ciclo); hoje o fluxo token sofre do mesmo, e o fallback devolveria 502 sem mensagem específica. **Registrado**: o smoke de hoje mede o mínimo; comportamento p/ diff < mínimo fica p/ depois (caso raro).
3. **Renovação da sub antiga durante a janela da sessão (60-90min)** invalida a proration calculada (usuário pagaria renovação + diff velha). Correção definida na revisão: snapshot da expiração na abertura (coluna `billing_period_end`, já existente e ociosa) + backstop compara e, se avançou, não aplica → manual. **Registrado — resolver depois** (não bloqueia o E2E).
4. **Coerção NUMERIC de `final_price`** — **resolvido na implementação** (embutido no passo 6 do backstop: `Number()` + null/NaN → manual, com teste).
5. **`billing-inspect --cleanup` não cobre a feature** — o select não mostra `payment_method`/`asaas_checkout_session_id`/`asaas_payment_id` e o veredito não checa linha fallback presa nem avulso CONFIRMED não estornado. **Registrado**: extensão leve (mostrar as colunas) recomendada junto do E2E; FAIL novo no veredito fica p/ depois.
6. **Retry do POST com pagamento em trânsito abre 2ª sessão** — fricção evitável (o usuário pode pagar 2×; o dedupe/política P0 converge o dinheiro, mas com passo manual no caso superseded). Polish futuro: `openCardFallbackCheckout` consultar o pagamento da sessão já registrada antes de criar outra. **Registrado**.
7. **Cartão genuinamente recusado pode criar payment em status de recusa** (≠ simulação por UUID) — o recheck filtra só CONFIRMED/RECEIVED/PENDING (asaas.ts:347), então cai no MESMO branch `CHARGE_FAILED`. **Registrado, nada a mudar**.
8. **Retry automático da DLQ `failed`** não existe (endpoint admin manual). O cron novo cobre o caso do fallback; agendar `reprocessAllFailed` no crontab da VPS é **opcional** (P1-B) — decisão do Sidney, fora do escopo deste plano.
9. **`credit_covered` sem token** segue com a mensagem honesta atual (não existe DETACHED de R$0). **Aceito — fora do escopo.**

---

## 5. Testes

### 5.1 Unitários/integração (vitest, `.test.ts` colado no código, `npm test`)

**`lib/card-fallback.test.ts`** (NOVO; mocks no padrão de plan-switch.test.ts — `vi.hoisted` + `vi.mock('@/lib/asaas')` + Supabase fake com builder chain):
1. Happy path: upsert da linha ANTES do `createDetachedCheckout`, session id persistido antes do retorno, resposta com URL.
2. `finalPrice <= 0` → `ok:false` 400, nenhuma chamada ao Asaas.
3. Upsert falhou → 500, `createDetachedCheckout` NÃO chamado (fail-closed).
4. `createDetachedCheckout` lançou → linha `cancelled` `CARD_FALLBACK_CREATE_FAILED`, 502.
5. Update do session id falhou → 503, URL NÃO retornada.

**`lib/plan-switch.test.ts`** (estender; cabeçalho de invariantes de dinheiro atualizado):
6. `runCardFallbackBackstop` happy path por session id: payment CONFIRMED + token → `executePlanSwitch` com `cardToken` NOVO e `reason 'card_fallback'` → **token salvo no profile SÓ DEPOIS do switch** → linha `paid` + `asaas_payment_id`.
7. Match por customer (payment sem `checkoutSession`).
8. Sem linha / `payment_method` ≠ fallback → `'no_match'` e NADA tocado.
9. Valor divergente (identidade forte) → `refundPayment` chamado, linha `cancelled`, alerta, `executePlanSwitch` NÃO chamado.
10. 🛡️ (P0) **Customer divergente → NENHUM estorno**: `refundPayment` NÃO chamado, alerta + throw (DLQ manual).
11. 🛡️ (P0) **`payment.checkoutSession` presente e ≠ linha → NENHUM estorno/aplicação**: alerta + throw.
12. Linha `paid` mesmo payment → `already_applied` sem estorno; payment diferente (session igual) → `refunded_duplicate`.
13. Linha `cancelled` (expirada) → estorno `refunded_superseded`.
14. 🛡️ (P1-C) Linha status `'overdue'` (fora do conjunto) → terminal fail-closed: estorno + alerta.
15. Payment REFUNDED → `externally_refunded`, sem switch.
16. Token ausente no payment → alerta + throw (DLQ), profile intocado.
17. 🛡️ (P1-A) **`executePlanSwitch` !ok → throw E `profiles.asaas_card_token` INTOCADO** (a prova anti-cobrança-dupla no retry).
18. 🛡️ (P2) `final_price` null → alerta + throw (manual), `refundPayment` NÃO chamado.
19. Lock ocupado → throw.
20. **Invariante anti-desconto-eterno**: `createSubscriptionWithToken` recebido com `value = fullPriceOf(plan, cycle)` — nunca o valor do avulso.

**Helper `findPaymentByCheckoutSession`** (junto dos testes de lib/asaas):
21. 🛡️ (P0-b) API devolve payments com `checkoutSession` DIFERENTE do pedido (filtro ignorado) → helper retorna **lista vazia**.

**`app/api/webhooks/asaas/route.test.ts`** (estender; mock de next/server já existente):
22. PAYMENT_CONFIRMED sem subscription com `checkoutSession` → `runCardFallbackBackstop` invocado, 200 processed, SEM throw.
23. Sem subscription, sem match (`'no_match'`) → continua lançando → DLQ (regressão do comportamento atual).
24. Branch `kind:planchange` intocado (regressão).
25. 🛡️ (P1-C) `PAYMENT_OVERDUE`/escrita genérica com linha `plan_switch_fallback` `pending` presente → `resolveBillingContext`/`updateCheckoutLink` NÃO tocam a linha do fallback.

**`app/api/cron/reconcile-checkouts/route.test.ts`** (estender):
26. 🛡️ (P1-D) Passo existente IGNORA linhas `plan_switch_fallback` (sem alerta falso "PRORATEADO/INSEGURO").
27. Linha ≥15min com pagamento CONFIRMED → backstop chamado (`source 'reconcile'`).
28. 🛡️ (P1-B) Linha ≥15min SEM pagamento e <90min → intocada (não expira cedo).
29. Linha ≥90min sem pagamento → `CARD_FALLBACK_EXPIRED`.

**`lib/plan-change-attempt.test.ts`** (estender): 30. linha `pending` `plan_switch_fallback` mesmo alvo → attempt CONTINUADO; alvo diferente → attempt novo.

**`lib/billing-launch-guard.test.ts`** (estender): 31. `isCardFallbackEnabled` default false / `'true'` liga.

### 5.2 SMOKE de hoje (gate — roda em paralelo com os commits 0-2)

Objetivo: fechar os 2 gates + mapear a correlação. Com a chave de produção do Asaas (env da Vercel / cofre — nunca em log):

1. `POST /checkouts` DETACHED (payload do 2.3a) com o customer de teste, valor **R$5** (se o gateway recusar por mínimo, anotar o mínimo real — P2 nº2).
2. **Sidney paga na URL com cartão real.** ← EM ANDAMENTO hoje.
3. `GET /payments?customer={id}` → achar o payment → `GET /payments/{id}` e registrar: **(a) `creditCard.creditCardToken` presente? (GATE 2 — go/no-go do desenho todo)**; (b) campo `checkoutSession` presente?; (c) `GET /payments?checkoutSession={sessionId}` filtra? **e 🛡️ (P0-b) `GET /payments?checkoutSession={id-INEXISTENTE}` → lista VAZIA?** (se devolver a listagem geral, o filtro é ignorado — o helper depende da validação client-side e o cron usa `GET /checkouts/{id}`).
4. Painel Asaas → Integrações → Webhooks → log do evento: o payload do PAYMENT_CONFIRMED traz `checkoutSession`? (decide se a escada correlaciona já no webhook ou só a partir do GET fresco/cron).
5. Confirmar o efeito colateral esperado: evento caiu na DLQ (`asaas_webhook_events` `failed`, "sem payment.subscription") — anotar e limpar depois.
6. Estornar: `POST /payments/{id}/refund`. Conferir o que o `PAYMENT_REFUNDED` sem subscription faz no webhook — esperado: DLQ/noop, profile intocado (edge "estorno no meio").

### 5.3 TESTE REAL EM PRODUÇÃO (E2E, cartão do dono, depois dos commits + flag ON)

Pré: deploy via `git push origin main` (Vercel auto-build); migration aplicada no Supabase (seção 6); `BILLING_CARD_FALLBACK=true` no env de Production; conta de teste resetada.

1. **Base**: comprar Starter mensal (cartão real) → conferir `profiles.asaas_card_token` preenchido. **Anotar o token.**
2. **Simular cartão morto** (SQL service-role no Supabase):
   `UPDATE profiles SET asaas_card_token = gen_random_uuid()::text WHERE id = '<profile-teste>';`
   (token do Asaas é string opaca; UUID aleatório é plausível e inválido — a revisão confirmou que a simulação é fiel ao caminho de código: 400 do Asaas → throw → recheck ok+null → `CHARGE_FAILED`). **Validar a simulação com a flag OFF primeiro**: tentar upgrade → deve morrer exatamente na tela de erro do `CHARGE_FAILED` (402), e NÃO em outro erro. Para o caminho `CARD_TOKEN_REQUIRED`: `SET asaas_card_token = NULL` → esperar o 409 atual.
3. **Fallback (CHARGE_FAILED)**: flag ON, token inválido → `/checkout/plus?cycle=monthly` → interstitial → **anotar o valor da diferença do preview** → pagar na sessão Asaas com cartão real → retorno `/billing?checkout=success` → overlay "Pagamento confirmado!" em ≤1min.
4. **CONFERÊNCIAS (as provas)**:
   - **Painel Asaas — A PROVA ANTI-DESCONTO-ETERNO: a sub NOVA tem `value` = preço CHEIO do Plus mensal (R$127), NÃO o valor prorateado do avulso; `nextDueDate` = hoje+30d.** Avulso = exatamente a diferença anotada, CONFIRMED. Sub antiga (Starter) DELETED/cancelada. Exatamente UMA sub ativa.
   - Supabase `profiles`: `plan='plus'`, `plan_cycle='MONTHLY'`, `asaas_subscription_id` = sub nova, **`asaas_card_token` MUDOU** (≠ UUID plantado — prova da captura do token novo, e 🛡️ P1-A: mudou só APÓS a troca concluída).
   - `billing_checkouts` `planchange-pay-{profile}`: `status='paid'`, `payment_method='plan_switch_fallback'`, `last_event='CARD_FALLBACK_PAID:pay_...'`, `asaas_payment_id` e `asaas_checkout_session_id` preenchidos.
   - `asaas_webhook_events`: evento `processed`; DLQ sem `failed` novo. Sem e-mail de alerta de ops espúrio (inclusive do cron horário — 🛡️ P1-D).
5. **Fallback (CARD_TOKEN_REQUIRED)**: `SET asaas_card_token = NULL` → nova troca (Plus→Pro ou ciclo) → mesmo roteiro (valida o assinante pré-tokenização).
6. **Abandono**: matar token de novo → abrir fallback → NÃO pagar → conferir que nada muda; disparar o cron manualmente com o `cron-secret` (a cadência real é 1×/h — 🛡️ P1-B): antes de 90min a linha NÃO expira; simulando/esperando >90min → linha `CARD_FALLBACK_EXPIRED`, plano intacto, R$0 cobrado.
7. **Limpeza**: estornar os avulsos (painel ou `/payments/{id}/refund`); deletar a sub de teste; resetar o profile p/ free via SQL — **lembrete: `plan_status='active'` (NOT NULL), não null**; conferir que o `PAYMENT_REFUNDED` não derrubou nada; limpar eventos de DLQ do teste.

---

## 6. Sequência de entrega

Tudo na `main` de `github.com/agenteseidos/eidosform` (push → Vercel auto-build). `npm test` verde antes de cada push. **Flag OFF por padrão = commits 1-5 são inertes em produção** (deploy seguro a qualquer momento).

| # | Entrega | Depende de | Esforço |
|---|---|---|---|
| **G** | **SMOKE R$5 (seção 5.2)** — em andamento hoje, corre em paralelo | — | ~20min + **Sidney paga** |
| 1 | Migration 2.1 + flag 2.2 (+ teste 31) | — | 15min |
| **1b** | ⚠️ **Aplicar a migration no Supabase de PRODUÇÃO (SQL editor, manual)** — a Vercel NÃO aplica migrations; sem isso o upsert com a coluna nova falha → 500 fail-closed (seguro, mas mata a feature silenciosamente) | 1 | 5min |
| 2 | Helpers `lib/asaas.ts` 2.3 — a forma final do payload DETACHED e do filtro `checkoutSession` fecha com o resultado do smoke (+ teste 21) | G (payload) | 45min |
| 3 | `lib/card-fallback.ts` + rota 2.5 + status 2.9 + frontend 2.11 (+ testes 1-5, 30) | 1, 1b, 2 | 1h30 |
| 4 | `runCardFallbackBackstop` 2.6 + webhook 2.7 (gancho + blindagem P1-C) + reprocess 2.8 (+ testes 6-25) | 2 (paralelo ao 3) | 2h30 |
| 5 | Cron 2.10 — filtro P1-D no passo existente + passo novo P1-B (+ testes 26-29) | 4 | 45min |
| 6 | **E2E produção (5.3)** com `BILLING_CARD_FALLBACK=true` | 3, 4, 5 | 45min + esperas |
| 7 | Pós-aprovação: inverter default da flag (`!== 'false'`, padrão BILLING_RECONCILE_*) + atualizar CLAUDE.md/ficha | 6 | 15min |

Paralelização: o smoke corre junto com 1-3; commits 3 e 4 são independentes entre si (ambos sobre o 2).

**Quando ligar a flag**: só no passo 6, após todos os commits + migration aplicada + smoke verde no gate 2. A inversão do default (feature "no ar" pra todo mundo) só após o E2E aprovado pelo Sidney.

**Pontos onde o Sidney age**:
- (a) **Smoke**: pagar a sessão de R$5 com cartão real e ler o log do webhook no painel Asaas (3 respostas: token? checkoutSession no payload? filtro na API + id inexistente → vazio?).
- (b) **Go/no-go do gate 2**: token voltou → plano segue; NÃO voltou → parar e acionar o plano B (seção 7).
- (c) **Migration**: aprovar/acompanhar a aplicação manual no Supabase de produção (passo 1b).
- (d) Setar `BILLING_CARD_FALLBACK=true` na Vercel (Production) antes do E2E.
- (e) **E2E**: pagar 2-3 vezes com cartão real e **conferir no painel Asaas que a sub nova está no preço CHEIO** (a prova anti-desconto-eterno).
- (f) Aprovar estornos/limpeza da conta de teste.
- (g) Aprovar a inversão do default da flag (feature no ar).
- (Opcional, fora do escopo: agendar `reprocessAllFailed` no crontab da VPS — melhora a retaguarda geral da DLQ, não só do fallback.)

---

## 7. Gates pendentes (go/no-go)

### Gate 2 — token no avulso DETACHED (R$5, EM ANDAMENTO hoje)

**Pergunta**: o pagamento de um checkout hospedado DETACHED devolve `creditCard.creditCardToken` reutilizável no `GET /payments/{id}`?
**Verde** = o campo vem preenchido no payment pago do smoke. É o interruptor do desenho inteiro: sem token capturável, não há como criar a sub nova no preço cheio com o cartão novo.
**O que bloqueia**: os commits 1-2 podem andar desde já (inertes); os commits 3-5 podem até ser escritos com a shape assumida, mas **nada liga em produção** (flag ON, passo 6) sem este verde.
**Vermelho** = parar e acionar o **plano B** (só esboço, não desenhar agora): checkout RECURRENT simbólico de R$5 cuja única função é tokenizar via assinatura (o único caminho de captura comprovado em produção — billing-activation.ts:215-235), cancel imediato da sub simbólica, cobrança da diferença via token novo, `executePlanSwitch` normal, estorno/abatimento dos R$5. Guard-rails: a sub simbólica nunca ativa plano (guard `isExpectedFullPrice` já bloqueia) + discriminador na linha p/ não spammar DLQ.

### Gate 1 — correlação (resolvido pelo desenho; smoke afina 2 detalhes)

O problema de fundo (Asaas não persiste `externalReference` no checkout hospedado) está **resolvido por desenho**: session id salvo na linha ANTES de entregar a URL + escada de correlação com identidade forte (P0). O smoke ainda responde 2 perguntas que afinam (mas NÃO bloqueiam) a implementação:
1. **O payload do webhook PAYMENT_CONFIRMED traz `checkoutSession`?** Sim → a escada correlaciona já no passo 1 do webhook. Não → correlação nasce no match por customer + GET fresco (e o binding de sessão do P0 atua quando o GET trouxer o campo).
2. **`GET /payments?checkoutSession=` filtra de verdade?** 🛡️ (P0-b) O teste decisivo é com **id INEXISTENTE → lista VAZIA** (filtro que "aceita o param" mas devolve a listagem geral da conta é o modo de falha catastrófico — estornaria pagamento de terceiro; por isso o helper valida client-side SEMPRE, independente da resposta). Filtro não suportado → o passo novo do cron usa `GET /checkouts/{id}`.

**Resumo do go/no-go**: smoke do gate 2 verde → implementar tudo (commits 3-5) e seguir pro E2E. Gate 2 vermelho → parar, plano B. As respostas do gate 1 apenas escolhem variantes já previstas no desenho.
