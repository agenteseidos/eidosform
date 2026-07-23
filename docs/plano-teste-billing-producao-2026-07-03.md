# Plano de teste de billing 100% em produção — EidosForm (2026-07-03)

> **Decisão do Sidney (03/07):** enquanto não há clientes reais (zero vendas), TODO teste de
> pagamento é feito direto em **produção**, com cartão real, estornando depois. Motivo: no
> passado o sandbox do Asaas mentiu (incidente 09/06 — correção de valor recorrente funcionava
> no sandbox mas o Asaas BLOQUEIA em produção). O sandbox não vale como prova. Este plano
> executa essa decisão com o menor blast radius possível.
>
> Base factual verificada ao vivo no repo (HEAD `0448fd1`): `app/api/checkout/[plan]/route.ts`
> (linhas 363/372), ausência de `catch` entre o `try` (~218) e o `finally` (~423),
> `STALE_MS=120_000` em `lib/billing-lock.ts`, backstop em `app/api/webhooks/asaas/route.ts`
> (~463), `sweep-received` com corte de 10 min em `lib/asaas-reprocess.ts`, `PLAN_PRICES` em
> `lib/asaas.ts` (Starter R$49/mês, Plus R$127/mês).

---

## Visão geral — 3 testes, o mínimo de cobranças

1. **Token no avulso** (R$1, zero código) — responde: um pagamento avulso `DETACHED` no
   checkout hospedado devolve `creditCardToken` reutilizável? É o **gate decisivo** da feature
   de "cartão morto". Fazer PRIMEIRO porque é o mais barato e não exige deploy.
2. **Fault injection + upgrade real, na MESMA cobrança** — o upgrade Starter→Plus do ciclo real
   já roteirizado É a mesma cobrança avulsa que o fault injection precisa. Faz-se o upgrade com
   a falha já armada: o dinheiro sai uma vez, e a conta chega em Plus pelo caminho do backstop
   em vez do síncrono. De brinde, é a confirmação E2E pós-hardening de 15/06 que está pendente.
3. **Resto do ciclo real** — downgrade Plus→Starter (R$0, saldo cobre) → cancelar → estornar.

**Custo bruto ~R$128, 3 estornos.** Único número não confirmado no repo: taxa de estorno do
Asaas (conferir no painel antes de começar).

---

## FASE 0 — Preparação (uma vez, ~10 min)

1. **Conta de teste limpa:**
   ```bash
   ENV_FILE=.env.production.local node scripts/billing-inspect.mjs sidney@institutoeidos.com.br --cleanup
   ```
   Exigir `✅ PASS`. Se `FAIL`, resolver antes (receita em `docs/smoke-test-real.md:54-90`,
   inclusive o SQL de reset do profile para `free`). ⚠️ O `CLAUDE.md` diz que a conta foi limpa
   em 10/06, mas o hardening que interessa é de 15/06 — **rodar o cleanup de novo
   independentemente do que o doc afirma.**
2. **Ferramentas em mãos:** `.env.production.local` puxado (`vercel env pull`); acesso ao painel
   Asaas de produção; `CRON_SECRET` (cofre `/home/sidney/.eidos-credentials/produtos/`); seu
   e-mail em `ADMIN_EMAILS` (pra usar `/api/admin/asaas/reprocess` se precisar); **taxa/prazo de
   estorno confirmados no painel Asaas** (Configurações → Tarifas — item aberto desde
   `docs/smoke-test-real.md:32`, nunca fechado).
3. **Descobrir o `profileId` (UUID)** da conta de teste — o inspetor não imprime, só o e-mail.
   No SQL Editor do Supabase:
   ```sql
   select id from profiles where email = 'sidney@institutoeidos.com.br';
   ```
   **Copiar/colar o UUID, nunca redigitar** — erro de digitação aqui faz o fault injection não
   disparar e você paga o upgrade à toa.
4. **Anotar o `asaas_customer_id`** atual (aparece no snapshot como `customer=cus_XXXX`), se já
   existir.

---

## FASE 1 — Token no pagamento avulso (mais barato, sem deploy, PRIMEIRO)

Responde só: *um pagamento avulso (`chargeTypes: DETACHED`) no checkout hospedado devolve
`creditCardToken` reutilizável?* Chamada HTTP crua contra a API do Asaas — não toca em nenhuma
rota do app.

> Nota de código: existe `createPaymentWithToken` (`lib/asaas.ts:284-303`), mas cobra via API
> usando um token que JÁ existe — é outra coisa. O `createCheckout` (`lib/asaas.ts:167-224`) tem
> `chargeTypes:['RECURRENT']` **hardcoded** (`:195`); `DETACHED` não existe em `.ts` nenhum.
> Por isso o teste é curl cru, não passa pelo código.

5. Usar o `cus_XXXX` do passo 4, ou criar um customer avulso:
   ```bash
   curl -X POST https://api.asaas.com/v3/customers \
     -H "access_token: $ASAAS_API_KEY" -H "Content-Type: application/json" \
     -d '{"name":"Sidney Teste Billing","email":"sidney@institutoeidos.com.br","cpfCnpj":"<seu CPF>"}'
   ```
6. Criar o checkout DETACHED de R$1,00:
   ```bash
   curl -X POST https://api.asaas.com/v3/checkouts \
     -H "access_token: $ASAAS_API_KEY" -H "Content-Type: application/json" \
     -d '{
       "customer": "cus_XXXXXXXXX",
       "billingTypes": ["CREDIT_CARD"],
       "chargeTypes": ["DETACHED"],
       "minutesToExpire": 30,
       "callback": {"successUrl":"https://eidosform.com.br/","cancelUrl":"https://eidosform.com.br/","expiredUrl":"https://eidosform.com.br/"},
       "items": [{"name":"Teste avulso - token","description":"smoke token DETACHED","quantity":1,"value":1.00}]
     }'
   ```
   Devolve uma `url` (expira em 30 min; não expor publicamente).
7. Abrir a URL, pagar R$1,00 com cartão real.
8. Achar o pagamento e conferir o token:
   ```bash
   curl "https://api.asaas.com/v3/payments?customer=cus_XXXXXXXXX&limit=5" -H "access_token: $ASAAS_API_KEY"
   # pegar o id do pagamento novo (R$1, CONFIRMED), depois:
   curl https://api.asaas.com/v3/payments/{paymentId} -H "access_token: $ASAAS_API_KEY"
   ```
   Verificar `.creditCard.creditCardToken` (mesmo campo lido por `extractCardToken`,
   `lib/asaas.ts:442-445`).
9. **Resultado:**
   - **Veio token** → o desenho do "cartão morto" (DETACHED + capturar cartão novo) é viável
     como especificado. Guardar o `paymentId` pra estornar na Fase 3.
   - **NÃO veio token** → a arquitetura proposta não funciona como desenhada. Saídas realistas
     sem sair do checkout hospedado: (a) usar `RECURRENT` com valor simbólico, capturar o token
     via webhook e **cancelar a sub imediatamente**; ou (b) manter o fail-closed atual até achar
     solução hospedada que tokenize sem cobrar. Não implementar nada hoje — é decisão de próximo
     passo.

**Não estornar ainda** — fechar tudo junto na Fase 3.

---

## FASE 2 — Fault injection + ciclo real (mesma cobrança)

> Honestidade: o Codex (03/07) recomendou fazer este cenário em **sandbox**. A decisão de
> produção-only sobrepõe isso. O desenho abaixo (gate por `profileId`, sem `process.exit`/
> SIGKILL real) reduz o risco ao mínimo praticável, mas **prova a LÓGICA de recuperação com um
> crash simulado, não um crash físico real**. Ao registrar o resultado, dizer isso — não vender
> como "testamos crash real".

10. **Setar a env var ANTES do deploy** (evita redeploy extra): Vercel → projeto `eidosform`
    (conta `agenteseidos`) → Settings → Environment Variables → Add:
    - Key: `BILLING_FAULT_INJECT_PLANCHANGE_PROFILE`
    - Value: o UUID do passo 3 (colar)
    - Environment: **Production apenas**
    ⚠️ Gotcha Vercel: env var nova só vale no **próximo deploy** — por isso setar antes do passo
    11.

11. **Patch mínimo e reversível** em `app/api/checkout/[plan]/route.ts`, logo após o bloco
    `if (!paidNow) {...}` (fecha ~371) e antes de `const nextDueDate = ...` (372):
    ```ts
    // FAULT INJECTION deliberada — teste de produção gated por profileId (reverter após o teste).
    if (process.env.BILLING_FAULT_INJECT_PLANCHANGE_PROFILE === profile.profileId) {
      logError('[checkout] FAULT INJECTION deliberada — simulando crash pós-pagamento/pré-troca', undefined,
        { userId: profile.profileId, paymentId: payment.id })
      throw new Error('FAULT_INJECTION_PLANCHANGE_TEST')
    }
    ```
    ```bash
    cd /home/sidney/eidosform
    git status   # árvore limpa antes de mexer
    # editar
    git add "app/api/checkout/[plan]/route.ts"
    git commit -m "test(billing): fault injection gated por profileId p/ teste de produção do backstop (reverter após o teste)"
    git push origin main
    ```
    Aguardar deploy `READY` (confirmar o SHA).

12. **Comprar Starter mensal (R$49)** pela UI, logado como a conta de teste. Confirmar via
    inspetor: 1 sub `ACTIVE` R$49, checkout `paid`, `asaas_card_token` preenchido. **Se aparecer
    "sem cartão salvo", PARAR** — tokenização não está funcionando e nada do resto vale.

13. **Disparar upgrade Starter→Plus** pela UI (a falha injetada dispara aqui). A tela dá 500 —
    é o esperado.

14. **Capturar o estado "quebrado" imediatamente:**
    ```bash
    ENV_FILE=.env.production.local node scripts/billing-inspect.mjs sidney@institutoeidos.com.br
    ```
    Esperado: `billing_checkouts` com `checkout_id=planchange-pay-<profileId>` em
    `status=recovering`; no Asaas, avulso `CONFIRMED` (~R$78); `profiles.plan` ainda `starter`.
    Confirmar nos logs da Vercel a linha `[checkout] FAULT INJECTION deliberada` (pra ter certeza
    de que foi esse gatilho, não outro bug).

15. **NÃO clicar em upgrade de novo.** O lock `planchange:{profileId}` foi liberado pelo
    `finally` (esperado — ver limitação); um novo clique criaria corrida com o backstop. Só
    observar.

16. **Observar a recuperação:**
    ```bash
    ENV_FILE=.env.production.local node scripts/billing-inspect.mjs sidney@institutoeidos.com.br --watch
    ```
    - **Normal (webhook, segundos a poucos min):** `billing_checkouts` vira `paid`
      (`PLAN_CHANGE_PAID_BACKSTOP:{paymentId}`), `profiles.plan` vira `plus`. Log:
      `[planchange-backstop:webhook]: troca concluída pelo backstop`.
    - **Se não recuperar em ~10-12 min:** disparar o sweep manualmente (GET idempotente,
      protegido por `CRON_SECRET`):
      ```bash
      curl -H "Authorization: Bearer $CRON_SECRET" https://eidosform.com.br/api/cron/sweep-received
      ```
    - **Se ainda não recuperar:** checar DLQ (`asaas_webhook_events.status='failed'`) e usar
      `POST /api/admin/asaas/reprocess` (autenticado como admin, body `{"eventId":"..."}`).
    - **Timeout absoluto: 70 min.** Se nada recuperou, é bug real de produção (o teste achou o
      que devia) — documentar e tratar como achado, NÃO forçar via SQL.

17. **GATE P0-2 (manual, obrigatório):** no painel Asaas, confirmar que a sub nova (Plus) **não**
    tem cobrança gerada hoje — só o avulso. Cruzar com a lista de pagamentos do inspetor (menos
    sujeito a erro que leitura visual). Se houver cobrança imediata na sub nova: parar (mesma
    bandeira vermelha de `docs/redesenho-upgrade-downgrade.md:73-77`).

18. **Reverter o código imediatamente após confirmar a recuperação:**
    ```bash
    git revert --no-edit <sha-do-commit-do-passo-11>
    git push origin main
    ```
    E remover a env var `BILLING_FAULT_INJECT_PLANCHANGE_PROFILE` da Vercel (cinto + suspensório).

19. **Continuar o ciclo real:** downgrade Plus→Starter pela UI (saldo cobre → R$0) → confirmar
    (sub Plus deletada, sub Starter nova `ACTIVE` R$49, `nextDueDate` = data de cobertura do
    saldo).

20. **Cancelar a assinatura** pela UI (soft-cancel, R$0) — evita cobrança futura quando o
    `nextDueDate` chegar.

---

## FASE 3 — Limpeza final (uma rodada, cobre Fase 1 e 2)

21. Confirmar **0 subs ACTIVE** no Asaas (inspetor).
22. Estornar no painel Asaas, **só depois de 0 subs ACTIVE**, nesta ordem: compra Starter
    (R$49) → avulso do upgrade (~R$78) → teste DETACHED (R$1).
23. Confirmar os 3 refunds via inspetor (`[REFUNDED]`, evento `PAYMENT_REFUNDED` chegou, sem
    DLQ).
24. Forçar profile para `free` via SQL se necessário (query em `docs/smoke-test-real.md:84-89` —
    `plan_status='active'` é o `free` legítimo, NUNCA `null`).
25. Auditoria final, exigir PASS:
    ```bash
    ENV_FILE=.env.production.local node scripts/billing-inspect.mjs sidney@institutoeidos.com.br --cleanup
    ```
26. Confirmar código normal: `git log --oneline -3` mostra patch **e** revert; `git diff 0448fd1
    -- "app/api/checkout/[plan]/route.ts"` vazio; env var removida da Vercel.
27. Só então marcar os checkboxes de `docs/smoke-test-real.md` e atualizar `CLAUDE.md` + ficha do
    vault com a confirmação pós-15/06.

---

## Riscos remanescentes + mitigação

| # | Risco | Mitigação |
|---|---|---|
| 1 | Env var não propaga (build cacheado / escopo errado) → `throw` não dispara → paga ~R$78 à toa | Confirmar env em **Production** e que o deployment "Current" tem timestamp DEPOIS do save. Colar o `profileId`. Não há como testar isso sem gastar — limitação genuína. |
| 2 | Corrida entre 2º clique e o backstop (lock liberado pelo `finally`) | Regra dura: após o 500, NÃO tocar no botão de upgrade. Só observar. Qualquer pagamento além dos 3 esperados = parar e investigar. |
| 3 | Backstop genuinamente não recupera (bug real) | Não é catastrófico (dinheiro cobrado 1×, rastreável). Documentar o estado, NÃO forçar via SQL (mascara o bug), estornar o avulso, deixar em Starter, tratar como bloqueador de lançamento. |
| 4 | Alerta falso-positivo de erro/500 | Avisar quem monitora que haverá uma janela curta de 500 deliberado. `sendBillingOpsAlert` CRÍTICO só dispara após `executePlanSwitch` retornar `!ok` — o `throw` é ANTES, então não dispara esse alerta; alertas genéricos de infra podem. |
| 5 | Diverge da recomendação do Codex (sandbox) | Tensão real não resolvida: gate por perfil cobre a lógica, mas não replica crash físico. Registrar como "testamos a lógica de recuperação com crash simulado", não "crash real". |
| 6 | Taxa de estorno desconhecida | Confirmar no painel Asaas antes de começar. Tratar como pequeno custo residual certo, não "tudo volta 100%". |
| 7 | Erro humano no GATE P0-2 | Cruzar sempre com a lista estruturada do inspetor, não só o painel visual. |
| 8 | Deixar rastro (esquecer revert / env var) | Passos 18 e 26 são checkpoints de limpeza — parte do teste, não "depois eu faço". |

**Risco residual honesto:** mesmo mitigado, é um erro deliberado no caminho de dinheiro em
produção sem rede de sandbox. Pior caso realista (risco 3) é recuperável e barato (~R$78 a mais
de estorno, nenhuma perda de dados), mas não é zero-risco.

---

## Custo estimado

| Item | Valor | Estorna? |
|---|---|---|
| Compra Starter mensal | R$ 49,00 | Sim |
| Avulso upgrade Starter→Plus (dispara o fault injection) | ~R$ 78,00 (varia com o timing; quanto mais rápido após a compra, mais perto do crédito cheio de R$49) | Sim |
| Downgrade Plus→Starter | R$ 0,00 (saldo cobre) | N/A |
| Cancelamento | R$ 0,00 | N/A |
| Teste token DETACHED | R$ 1,00 | Sim |
| **Total bruto** | **~R$ 128,00** | **3 estornos** |
| Custo residual (taxa de gateway não devolvida) | Não confirmado no repo — provavelmente poucos reais | — |

Combinar fault injection + upgrade real evita uma 2ª rodada de ~R$78 (testados separados dariam
~R$206).
