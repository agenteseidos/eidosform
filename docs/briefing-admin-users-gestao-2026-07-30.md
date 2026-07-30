# Briefing para parecer (Codex) — /admin/users como painel de GESTÃO de contas

**Data:** 2026-07-30
**Solicitante:** Sidney
**Autor:** Claude (auditoria da página + análise da logística de billing por trás)
**Estado do repo:** `main` = `561924f`, produção sã, pós-auditoria pré-venda (tag `pre-venda-2026-07-29`)
**Natureza:** proposta de evolução — NADA foi implementado. Codex: critique, ajuste e devolva o plano viável.

---

## 1. O pedido do Sidney (verbatim, resumido)

O painel `/admin/users` precisa permitir "ajustar toda e qualquer situação dos usuários,
manualmente": mudar plano, mudar mensal↔anual, aumentar/diminuir data de expiração. Com uma
exigência central de COERÊNCIA COM A COBRANÇA:

> "Se a pessoa tem um plano Plus mensal até 15/08/2026 e eu decido dar mais 15 dias (vai até
> 30/08), ela só pode ser cobrada conforme esse ajuste — ou seja, no dia 30."

E dois incômodos imediatos na tela atual: contas aparecendo "Sem expiração" que não deveriam
(só a `medeiros.sco@gmail.com` é vitalícia), e ausência da informação mensal/anual.

---

## 2. O que o painel É hoje (auditado no código)

**Tela** (`components/admin/admin-users-table.tsx`, 363 linhas):
colunas E-mail · Plano · Expiração · Criação · Nº de forms; busca por e-mail (server-side,
debounce); paginação 20/página; ações **"Ver como dono"** (snapshot read-only) e **"Alterar
plano"** (dialog: select de plano + date-picker de expiração + atalhos +7/+30/+90/sem-expiração).

**Rota de listagem** (`app/api/admin/users/route.ts`): seleciona SÓ
`id, email, plan, plan_expires_at, plan_status, created_at` + contagem de forms.
**Não busca:** `plan_cycle`, `lifetime_access`, `asaas_customer_id/subscription_id`,
`responses_used/limit`, `response_period_*`, `phone`, `email_confirmed_at`.

**Rota de escrita** (`app/api/admin/users/[id]/plan/route.ts`) — melhor do que a tela sugere:
- ✅ Bloqueia troca PAGO→PAGO de quem tem sub Asaas (409) — evita divergência de cobrança (P1 do Codex de 06/08).
- ✅ Mover para free CANCELA a sub no Asaas ANTES, fail-closed (P0 de 06/08).
- ✅ `handleDowngrade` recebe `targetPlan` (o P1-11 da auditoria de ontem já foi corrigido).
- ✅ Valida expiração no futuro; free força expiração nula.

## 3. Problemas REAIS encontrados na auditoria (não são wishlist)

### 🔴 A1 — Ajustar SÓ a expiração zera a cota mensal do cliente (bug existente hoje)
`plan/route.ts:133-135`: o PATCH aplica **sempre** `responses_limit` + `buildResponseQuotaPeriodReset()`
(= `responses_used: 0` + período novo) + `limit_alert_sent: false` — **mesmo quando o plano não
mudou** e o admin só mexeu na data. Cenário: cliente Starter com 900/1000 usadas no período;
Sidney dá +15 dias de cortesia; **o contador volta a 0/1000 e o período reinicia**. Cortesia de
prazo virou cortesia de cota, sem ninguém decidir isso. Em sentido oposto, é também um vetor de
"reset de cota grátis" por engano operacional.

### 🔴 A2 — Estender expiração NÃO move a cobrança no Asaas (o caso exato do Sidney)
O PATCH grava `plan_expires_at` local e **não toca a assinatura**. No exemplo Plus-mensal
15/08→30/08: o Asaas continua com `nextDueDate = 15/08` e **cobra dia 15 mesmo assim**. Pior: o
webhook `PAYMENT_CONFIRMED` dessa cobrança re-deriva a expiração a partir do próximo `nextDueDate`
real (lógica do billing-activation) — ou seja, **a cortesia é silenciosamente engolida** pelo ciclo
seguinte. As duas ferramentas para fazer certo **já existem** em `lib/asaas.ts` e hoje não têm
nenhum chamador admin:
- `updateSubscription(subId, { nextDueDate: 'YYYY-MM-DD' })` (`asaas.ts:717`)
- `alignPendingPaymentsDueDate(subId, dueDate)` (`asaas.ts:544`, usada pelo reprocess p/ mover
  cobranças PENDING já emitidas)

### 🟠 A3 — Conta vitalícia: o painel mente para o admin
A blindagem de 29/07 (trigger `enforce_lifetime_profile`) **reverte silenciosamente** qualquer
tentativa de alterar a `medeiros.sco@gmail.com`. O UPDATE não dá erro — o trigger corrige os
valores NA ESCRITA. A tela então faz update otimista (`admin-users-table.tsx:177-181`) e mostra
"Free" com sucesso… enquanto o banco manteve professional. O painel nem sabe que `lifetime_access`
existe (a coluna não é buscada).

### 🟠 A4 — "Sem expiração" não distingue vitalício de grant esquecido
`pro@test.eidos` (professional) e `zefa-v5-14157` (starter) aparecem "Sem expiração" igual à conta
do Sidney. São grants manuais sem data — plano pago eterno POR OMISSÃO, não por decisão. O painel
deveria tratar `pago + sem expiração + lifetime_access=false` como **anomalia visível**, não como
estado neutro. (O atalho "Sem expiração" no dialog atual até INCENTIVA criar mais desses.)

### 🟡 A5 — Informação de gestão ausente
Sem `plan_cycle` (o pedido do Sidney), sem status (`canceling` não aparece — cliente que cancelou
e mantém acesso fica indistinguível), sem uso de cota (`responses_used/limit` + período), sem
telefone, sem e-mail confirmado, sem link para o customer/sub no painel do Asaas, sem filtro por
plano/status, sem CSV.

### 🟡 A6 — Zero trilha de auditoria
Ações de admin que mexem em dinheiro (plano, expiração, cancelamento de sub) não registram
quem/quando/antes/depois em lugar nenhum além do log efêmero da Vercel. Ontem mesmo precisamos
reconstruir "quem alterou o quê" por arqueologia de migrations.

---

## 4. A logística de billing por trás de cada ajuste (o coração do briefing)

Análise caso a caso do que "ajustar manualmente" implica no gateway. É aqui que quero o teu
parecer mais duro, Codex.

### Caso A — Estender/reduzir expiração de quem TEM sub Asaas (o exemplo do Sidney)
**Mecânica proposta:** numa ação dedicada "Ajustar expiração" (separada de "Alterar plano"):
1. `updateSubscription(subId, { nextDueDate: novaData })`;
2. `alignPendingPaymentsDueDate(subId, novaData)` — move cobranças PENDING já emitidas (o
   reprocess já faz isso em `asaas-reprocess.ts:181`; reutilizar o padrão);
3. só se (1) ok → `UPDATE profiles.plan_expires_at` (fail-closed, mesmo desenho do
   cancel-antes-de-free que a rota já usa);
4. **NÃO** tocar em cota/período (correção do A1);
5. registrar na trilha (Fase 3).
**Efeitos em cascata que eu verifiquei:** a renovação futura recalcula `proration_basis_days`
pela diferença real de datas (writers de 03/07) — período esticado gera base maior, coerente.
`plan_expires_at` maior também adia o rebaixamento da RPC de cota (o "pagante vira 100" só
dispara após a expiração local — mover a data para frente REDUZ esse risco, não aumenta).
**Riscos a validar contigo:** comportamento do Asaas ao mover `nextDueDate` de sub ANUAL;
mover para trás (reduzir cortesia) com cobrança já emitida; interação com sub `canceling`.

### Caso B — Estender expiração de grant manual (sem sub)
Só `plan_expires_at` local. Trivial. É também o caminho para SANEAR o A4: dar data aos dois
grants eternos de teste.

### Caso C — Mudar mensal↔anual
**Recomendo NÃO fazer pelo admin, manter o 409** — e aqui divirjo do pedido literal do Sidney,
com justificativa: trocar ciclo de uma sub ativa exige recriar valor/cobrança (proração, cartão,
`PLAN_PRICES`) e é exatamente a classe de operação que o teu P1 de 06/08 baniu do admin. O fluxo
do USUÁRIO (checkout de troca) já faz isso certo, com preview e idempotência. Proposta
alternativa: o admin enxerga o ciclo (A5) e, se precisar migrar alguém, usa "mover p/ free +
instruir novo checkout" ou o próprio usuário troca. Se o Sidney insistir no atalho admin, que
seja Fase 5, com desenho próprio — não de carona.

### Caso D — Upgrade/downgrade de plano de quem tem sub
Continua bloqueado (409) pelo motivo original. O dialog deveria EXPLICAR o porquê e apontar o
caminho, em vez de só falhar.

### Caso E — Conta vitalícia
Painel deve mostrar 🛡️ e **desabilitar** ações, com nota "alterável só via SQL como postgres".
Qualquer outra coisa é a mentira do A3.

---

## 5. Plano de execução proposto (fases independentes, cada uma deployável sozinha)

**Fase 0 — consertos no que JÁ existe (meio dia, risco baixo):**
(a) A1: `buildResponseQuotaPeriodReset` só quando o PLANO mudou de fato;
(b) A3/E: buscar `lifetime_access`, badge 🛡️, ações desabilitadas;
(c) tela: coluna Ciclo (mensal/anual/—) e badge de status (`active/canceling/cancelled/expired`),
    marcação de anomalia do A4. Só leitura — a rota de listagem passa a selecionar os campos.

**Fase 1 — painel informativo (1 sessão):** drawer de detalhe por usuário: cota usada/limite +
período corrente, telefone, e-mail confirmado, `asaas_customer_id`/`subscription_id` com link
direto pro dashboard do Asaas, forms (nº + pausados), datas. Filtros por plano/status. Nada de
escrita.

**Fase 2 — "Ajustar expiração" com sincronização Asaas (1 sessão + teste em produção):** a ação
do Caso A, fail-closed, com preview ("cobrança atual 15/08 → nova 30/08") e confirmação. Teste
real: sub de teste, mover data, confirmar no Asaas, estornar/limpar.

**Fase 3 — trilha de auditoria (meia sessão):** tabela `admin_actions` (admin_email, user_id,
ação, payload antes/depois, timestamp), escrita em TODAS as rotas admin de mutação, aba
"Histórico" no drawer. Sem UI de edição — só registro.

**Fase 4 — saneamento de dados (SQL manual, 10 min):** dar expiração (ou free) aos dois grants
eternos de teste; decisão do Sidney conta a conta.

**Fase 5 (se o Sidney insistir) — troca de ciclo via admin:** desenho dedicado, contigo.

## 6. Perguntas diretas ao Codex

1. **A2/Caso A:** confirmas que `updateSubscription({nextDueDate})` + `alignPendingPaymentsDueDate`
   é a alavanca certa e suficiente? Há armadilha com sub anual, `canceling`, ou mover data p/ trás?
2. **A1:** concordas que resetar cota em ajuste-sem-troca-de-plano é bug a corrigir na Fase 0?
   Há razão legítima para o comportamento atual que eu não vi?
3. **Caso C:** sustentas o teu 409 de 06/08 também contra o pedido do Sidney, ou vês um desenho
   seguro de troca de ciclo pelo admin que eu descartei rápido demais?
4. A trilha da Fase 3 te parece suficiente como formato (tabela + escrita nas rotas), ou queres
   outbox/imutabilidade?
5. Ordem das fases: mudarias algo? Algum P0 que eu classifiquei como cosmético?
