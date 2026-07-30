# Briefing para auditoria (Codex) — Pré-venda do EidosForm

**Data:** 2026-07-29
**Solicitante:** Sidney
**Autor do briefing:** Claude (sessão Claude Code na VPS)
**Estado do repo:** `origin/main` = `b07e037`, working tree limpa, tudo deployado e READY
**Baseline:** 701 testes verdes (54 arquivos) · `tsc --noEmit` 0 erros · eslint 0 erros, 2 warnings pré-existentes

---

## 1. Por que esta auditoria, agora

O EidosForm está **prestes a começar a vender de fato**. Nas últimas 24h o produto recebeu 13
commits de **três autores diferentes** (uma sessão do Claude pelo app do celular, uma sessão do
Claude Code na VPS, e o agente Zeca/OpenClaw), e o Sidney não está confiante no resultado.

A desconfiança é fundamentada, e eu sou parte do motivo. **Nas últimas 24h eu afirmei três coisas
falsas com convicção**, todas desmentidas depois por evidência:

1. Afirmei que 3 crons de billing "não tinham agendador nenhum" — tinham, rodando de hora em hora
   no crontab. Meu `grep` filtrava por "eidosform" e o caminho real é
   `.eidos-credentials/produtos/run-cron.sh`.
2. Afirmei que o enforcement da cota do Free "usa PLANS e ignora a coluna do banco" — errado, eu
   tinha lido uma função MORTA (`checkResponseLimit`, removida no mesmo dia). O caminho vivo é a
   RPC `check_and_increment_response`, que RESPEITA `profiles.responses_limit`.
3. Afirmei que o projeto não tinha auto-deploy por push (baseado na flag `sourceless: true`) —
   errado, o Sidney me corrigiu e a evidência confirmou: 5 dos 7 pushes do dia viraram deploy em
   ~2s sem hook.

Também afirmei que "leads receberiam alerta de WhatsApp em dobro" — exagero: existe trava de
idempotência que teria impedido.

**Consequência para esta auditoria:** minha auto-revisão já falhou neste período. O valor do seu
trabalho aqui está justamente em não herdar minhas conclusões. **Trate tudo que eu afirmo neste
documento como hipótese a ser verificada, não como contexto dado.**

---

## 2. Escopo acordado com o Sidney

Descartamos auditar 100% do código (~51 mil linhas, 271 arquivos .ts/.tsx, 71 migrations) porque
diluiria atenção igualmente entre código que decide cobrança e código de estilo de botão — e boa
parte do núcleo crítico **já passou por auditoria adversarial sua** em sessões anteriores (§8).

**Critério do recorte: o que toca dinheiro do cliente, dados de outro cliente, ou a porta de
entrada de quem não está autenticado.** Quatro frentes, todas com profundidade alta:

- **Frente A** — as últimas 24h (§4)
- **Frente B** — dinheiro (§5)
- **Frente C** — isolamento entre clientes / RLS (§6)
- **Frente D** — portas não autenticadas (§7)

**Fora do escopo desta rodada** (passada leve depois): telas administrativas internas, scripts de
manutenção, polimento visual, páginas legadas sem tráfego, o construtor de formulários em si.

Se você achar que o recorte está errado — que algo de fora merecia estar dentro — **diga isso
explicitamente**, é uma resposta legítima e útil.

---

## 3. Estado verificado do ambiente (não confie na sua memória do repo)

| Fato | Valor | Como foi verificado |
|---|---|---|
| `origin/main` | `b07e037` | `git ls-remote` |
| Produção | `b07e037`, READY | API da Vercel (`/v6/deployments`) |
| Conta Vercel | **Hobby** (máx. 2 crons, só diários) | API `/v2/teams` |
| Crons na Vercel | **1** — `expire-plans` `0 3 * * *` | API `/v9/projects` |
| Crons na VPS | 3 no crontab do user `sidney` (`7 * * * *` reconcile-checkouts, `22 * * * *` sweep-received, `37 * * * *` reconcile-subscriptions) + timer systemd `eidosform-abandoned.timer` (15 min) | `crontab -l`, `systemctl list-timers` |
| Contas no banco | 14 free · 1 starter · 1 plus · 2 professional | REST do Supabase |
| Contas em 80%+ da cota | 0 | idem |
| Rotas de API | 60 no total, **14 sem checagem de auth explícita** | varredura por `route.ts` |
| Arquivos usando service_role (bypassa RLS) | **69** | grep |
| Decisões de plano por comparação de string | **78 ocorrências** | grep |

⚠️ **Gotcha de deploy que custou 1h30 ontem:** o auto-deploy por push funciona, **mas dois pushes
do dia (`202eb8d` 20:53 e `f45050b` 21:01) não geraram deployment nenhum** — nem produção nem
preview. Causa não determinada (a Vercel integra via GitHub App; o repo tem zero webhooks próprios
para inspecionar entregas). Nunca conclua "está no ar" sem conferir o SHA servido.

---

## 4. FRENTE A — As últimas 24h

**13 commits, 45 arquivos, +1547/−709** (excluindo docs). Range: `b2fe0e4..b07e037`.

### 4.1 Origem dos commits — três autores, revisão desigual

| Commits | Autor | Revisão que já teve |
|---|---|---|
| `0fc2299` | Claude (celular) | nenhuma — quebrou o lint da `main` |
| `9e6c258`, `57c9139`, `397c4ea`, `a25d900`, `202eb8d`, `f45050b` | Claude (celular) | leitura de diff por mim + sua 1ª auditoria |
| `724e485`, `7bd3e78`, `9e45d31`, `a32edf4`, `923bd2e` | Claude (VPS, eu) | **nenhuma revisão externa** |
| `b07e037` | **Zeca (OpenClaw)** | **NENHUMA — ninguém revisou** |

🔴 **`b07e037` é ponto cego total.** Foi commitado por outro agente às 23:14, depois que eu já tinha
encerrado, e foi direto para produção. Assunto: a rota de logs do painel admin do WhatsApp pintava
de vermelho status que eram sucesso (`abandoned_alert` com `wacli_message_id` = entregue;
`skipped` = decidimos não enviar). Extraiu `traduzirStatusLog`. **Ninguém auditou. Priorize.**

### 4.2 O que mudou, por tema

**(a) Gates de plano — vazamentos fechados (`9e6c258`)**
- `redirect_url` era vendido no Starter e **funcionava no Free**: agora 403 no PATCH
  (`app/api/forms/[id]/route.ts`), strip silencioso na criação (`app/api/forms/route.ts`), player
  anula para dono Free (`app/f/[slug]/page.tsx`), campo travado no builder.
- `syncToSheetsIfEnabled` passa a receber `ownerPlan` e revalidar `PLANS[].googleSheets` no envio
  de parciais — antes não revalidava pós-downgrade. **Esta é a mudança mais invasiva do pacote**:
  `ownerPlan` atravessa criação, update por token, adoção por session key e a corrida 23505 via
  `updateCtx`.
- Gate de API key passa a ler `PLANS[].apiAccess` em vez de `!== 'professional'`.
- `checkResponseLimit` (morta) removida → `sendNearLimitAlert` com gate `planAtLeast(plan,'plus')`.

**(b) Fonte única da vitrine de planos (`57c9139`)** — novo `lib/plan-marketing.ts` com preços e
cotas **derivados** de `PLANS`, consumido por 5 componentes (raiz, v2, v3, v4, billing).
`lib/plan-marketing.test.ts` tem 23 asserts que quebram o CI se a vitrine prometer o que o runtime
nega. −492 linhas duplicadas.

**(c) Analytics + UTM (`397c4ea`, corrigido em `7bd3e78`)** — painel novo de abandono por pergunta;
UTM no payload do webhook (campo aditivo) e como `{utm_*}` no template de WhatsApp.

**(d) Copy das `/v3` e `/v4` (`a25d900`, corrigido em `7bd3e78` e `923bd2e`)** — ver §4.4.

**(e) Crons e cota do Free (`724e485`)** — 4 crons sub-diários revertidos do `vercel.json`
(duplicavam a VPS e a conta Hobby recusaria o deploy); migration `20260728_free_quota_100.sql`
padroniza a cota do Free em 100 no trigger `handle_new_user()` **e regulariza os perfis
existentes**. Aplicada em produção pelo Sidney.

**(f) Telefone obrigatório no cadastro (`9e45d31`)** — `/register` pede Nome → Telefone → E-mail.
Telefone viaja em `options.data` do `signUp` → `raw_user_meta_data` → trigger → `profiles.phone`,
normalizado por `toWhatsAppDigits` (dígitos com DDI). Migration
`20260728_signup_phone_to_profile.sql`, aplicada em produção. Briefing dedicado:
`docs/briefing-telefone-no-cadastro.md`.

**(g) Ajustes pós-sua-1ª-auditoria (`923bd2e`)** — alerta de 80% removido da vitrine; gate de
redirect do player unificado para ler `PLANS[].redirect`; teste novo do endpoint de analytics.

### 4.3 O que a sua 1ª auditoria já pegou e foi corrigido

Você auditou as Fases 1–4 ontem. Corrigido desde então: os 4 crons duplicados; a cota do Free
(50→100); o gate hardcoded do player (A1); o bug de UTM perdido na revalidação do lead abandonado;
o "tempo médio de preenchimento" removido de ponta a ponta (consultava `created_at`/`updated_at`,
colunas que **não existem** em `responses`); e as promessas sem lastro da copy (§4.4).

**NÃO corrigidos, por decisão consciente do Sidney** — não os reporte como achados novos, mas
**diga se discorda da priorização**:
- Confiabilidade do alerta de 80%: fire-and-forget, sem retry/outbox, disparado fora de `after()`.
  Decisão: não vale o esforço — plateia atual são 3 contas Plus+, zero perto do limite.
- Acoplamento `partialResponses` ↔ analytics avançado (A3): duas features num flag só.

### 4.4 Promessas de marketing removidas (contexto para não reintroduzir)

Você identificou 4 overclaims na Fase 4. Todos removidos da copy, e registrados como
"NÃO ANUNCIAR" em `CLAUDE.md` e no topo de `app/v3/page.tsx` / `app/v4/page.tsx`:
- **Meta CAPI server-side** — um `META_PIXEL_ID`/token GLOBAL, mas os pixels dos clientes são POR
  FORMULÁRIO; todo evento sai como `Lead`; `event_id` é o NOME do evento (sem dedup real).
- **UTM na mensagem de WhatsApp "por padrão"** — variáveis existem, templates padrão não as usam.
- **"pergunta exata onde desistiu"** — o dado é a última pergunta RESPONDIDA.
- **"tempo médio de preenchimento"** — não calculável: `responses` não tem timestamp de início.

⚠️ **`/v3` e `/v4` vão AMBAS ao ar** (decisão Sidney 29/07 — o A/B continua, ainda não escolheu
qual promover à raiz). As duas são `noindex`. **A raiz, que é a página indexada pelo Google,
continua com a copy antiga** e recebeu só a vitrine de preços nova (componente compartilhado).
**Verifique se a raiz não ficou internamente contraditória** — vitrine corrigida + corpo de texto
antigo.

### 4.5 Perguntas específicas da Frente A

- **A-1.** `b07e037` (Zeca): a tradução de status está correta para TODOS os estados possíveis da
  tabela de logs? `traduzirStatusLog` cobre o conjunto real de valores que o banco produz, ou só
  os que apareceram na tela? Há caminho onde uma FALHA REAL passa a ser pintada de verde — que
  seria o inverso do bug e muito pior?
- **A-2.** `syncToSheetsIfEnabled` com `ownerPlan` atravessando `updateCtx`: existe caminho onde o
  plano se perde ou chega errado (adoção por session key, corrida 23505, retry)? Você já disse que
  não encontrou; **tente de novo com foco em falha parcial** (perfil ilegível, downgrade no meio do
  fluxo). A cobertura testa Free só no caminho de criação.
- **A-3.** A migration `20260728_free_quota_100.sql` fez `UPDATE ... WHERE plan='free' AND
  responses_limit BETWEEN 0 AND 99`. Alguma conta legítima podia ter cota reduzida de propósito
  (punição, teste, plano especial) e foi elevada indevidamente? Há registro de quem foi alterado?
- **A-4.** Subir a cota do Free de 50 para 100 **dobra o custo de armazenamento e o teto de abuso
  de conta grátis**. Eu apresentei isso ao Sidney como "corrigir uma mentira" e **não levantei o
  lado do custo/abuso**. Isso merecia uma ressalva? Existe rate limit por formulário público que
  torne isso irrelevante?
- **A-5.** O teste que escrevi para o endpoint de analytics (`app/api/forms/[id]/analytics/route.test.ts`)
  usa mock pesado da cadeia do PostgREST. **Provei que ele pega a regressão** (reintroduzi
  `created_at` e 4 casos quebraram), mas: o mock reflete o comportamento real da cadeia
  `.select().eq().eq()`? Ou é falso conforto que passa a valer como "coberto"?
- **A-6.** `f45050b` trocou guarda de hidratação por `useSyncExternalStore` em dois mobile-menus.
  Você já validou. **Confirme só se há divergência SSR/CSR** em alguma rota que renderize esses
  componentes com estado inicial diferente.

---

## 5. FRENTE B — Dinheiro

**Contexto: o billing já foi auditado por você e testado com dinheiro real em produção** (compras,
upgrade, downgrade, cancelamento, reativação, cartão morto, proração). **Não quero que refaça essa
auditoria do zero.** Quero foco na **fronteira nova** que as últimas 24h criaram.

**Arquivos:** `lib/asaas.ts`, `lib/plan-switch.ts`, `lib/plan-change.ts`, `lib/proration.ts`,
`lib/billing-activation.ts`, `lib/billing-lock.ts`, `lib/billing-profile.ts`, `lib/plan-limits.ts`,
`lib/plan-definitions.ts`, `lib/plans.ts`, `app/api/checkout/[plan]/route.ts`,
`app/api/webhooks/asaas/route.ts`, `app/api/subscription/cancel/route.ts`,
`app/api/cron/reconcile-*/route.ts`.

### Perguntas da Frente B

- **B-1. A fronteira cota × billing.** `profiles.responses_limit` é escrita por **5 caminhos
  diferentes** (`billing-activation.ts:71`, `plan-switch.ts:189`, `webhooks/asaas/route.ts:782`,
  `admin/users/[id]/plan/route.ts:132`, e agora o **trigger do banco**), todos com o padrão
  `planConfig?.maxResponses ?? 100`. **A migration de ontem introduziu um SEXTO escritor que não
  conhece os outros cinco.** Há cenário onde o trigger e um fluxo de billing brigam pela mesma
  linha? Upgrade→downgrade→reativação preserva a cota correta agora que o Free é 100?
- **B-2.** `app/(dashboard)/billing/page.tsx:37` faz `profile?.responses_limit ?? 100` — a UI de
  cobrança confia na coluna. Depois da mudança de ontem, o que a tela mostra bate com o que a RPC
  realmente permite, em todos os planos?
- **B-3.** A RPC `check_and_increment_response` cai no default `100` quando `responses_limit` é
  NULL. Existe caminho que deixa a coluna NULL num plano PAGO (ex.: cancelamento, expiração)? Aí um
  Professional cairia para 100 silenciosamente.
- **B-4.** `plan-marketing.ts` deriva preço e cota de `PLANS`. Confirme que **não existe divergência
  entre o que a vitrine anuncia e o que o Asaas cobra de verdade** — em especial nos ciclos anual
  vs mensal, onde a página mostra "por mês pago anualmente".
- **B-5.** Ainda existem **78 lugares** decidindo plano por comparação de string (`=== 'free'`,
  `!== 'free'`, `=== 'professional'`). Eu corrigi **um** deles ontem. Quais dos 78 restantes tocam
  dinheiro ou liberação de recurso pago? Quero uma lista priorizada, não todos.

---

## 6. FRENTE C — Isolamento entre clientes (RLS)

**Nunca foi tocado nas últimas 24h, e é por isso mesmo que entra:** é o pior bug possível de
descobrir depois de ter clientes pagantes — cliente A enxergando dado de cliente B. Prestes a
vender é o momento certo de bater nisso com olhar adversarial.

**Superfície:** 69 arquivos usam `createPublicClient`/`createAdminClient`/service_role, que
**bypassam RLS por construção**. Tabelas com policies: `responses`, `answer_items`, `forms`,
`profiles`, `billing_checkouts`, `form_whatsapp_settings`, `form_whatsapp_logs`, `custom_domains`,
`rate_limit_entries`. Migrations relevantes: `20260428_consolidate_rls_policies.sql`,
`20260430_fix_rls_responses_answer_items_profiles.sql`, `20260501_enforce_rls_final_state.sql`,
`20260518_p1_6_remove_anon_insert_answer_items.sql`.

### Perguntas da Frente C

- **C-1.** Cada uso de service_role é **justificado**? Quero os casos onde um cliente autenticado
  normal bastaria e o service_role foi usado por conveniência — cada um desses é um bypass de RLS
  esperando um bug de filtro (`.eq('user_id', ...)` esquecido).
- **C-2.** Existe endpoint que aceita um `id` do cliente e busca com service_role **sem confirmar
  ownership**? Esse é o padrão exato do vazamento entre contas.
- **C-3.** O estado final de RLS no banco **bate com o que as migrations dizem**? (As migrations
  são a intenção; o banco é a verdade — e já houve caso neste projeto de policy faltando na
  prática, o incidente do upload de imagem em `storage.objects`.)
- **C-4.** `answer_items` e `responses` têm 38 e 33 referências em migrations — muita mexida. O
  estado atual está coerente, ou sobrou policy antiga permissiva de uma iteração anterior?

---

## 7. FRENTE D — Portas não autenticadas

**14 das 60 rotas não têm checagem de auth explícita.** Algumas são públicas por design; quero
saber se **todas** deveriam ser:

```
app/api/auth/signup            ← MEXIDO ONTEM (telefone obrigatório)
app/api/auth/login
app/api/auth/forgot-password
app/api/auth/resend-verification
app/api/responses/partial      ← MEXIDO ONTEM (ownerPlan no Sheets)
app/api/webhooks/asaas         ← autentica por token do Asaas, não por sessão
app/api/upload/sign-url
app/api/cep/[cep]
app/api/health
app/api/whatsapp/send
app/api/plano/lookup
app/api/migracao/recommend
app/api/internal/conversion/check
app/api/forms/[id]/plan
```

### Perguntas da Frente D

- **D-1.** `app/api/whatsapp/send` sem auth explícita **me preocupa mais que as outras** — se
  qualquer um puder disparar envio, é custo e reputação do número. Como está protegida?
- **D-2.** `app/api/forms/[id]/plan` e `app/api/plano/lookup` expõem informação de plano a partir
  de um id. Vaza dado de outro cliente? Serve de oráculo para enumerar contas?
- **D-3.** `app/api/upload/sign-url` — quem pode assinar URL, e para qual bucket/caminho?
- **D-4.** `signup` agora exige telefone e o valida com `isValidWhatsAppPhone` **antes** de consumir
  rate limit. Isso está certo (não gasta cota com payload inválido) ou cria um oráculo barato para
  enumerar/abusar? O rate limit é por e-mail — dá para contornar variando o e-mail?
- **D-5.** `signup` grava telefone em `raw_user_meta_data`, que é **dado controlado pelo cliente**.
  Ele é lido pelo trigger `handle_new_user()` e escrito em `profiles.phone`, que alimenta a coluna
  GERADA `phone_match_key_br` e o cadastro do Asaas. Há injeção/abuso possível por aí? (Ex.: um
  telefone forjado que colida de propósito com o `phone_match_key_br` de outro cliente e sequestre
  atribuição de follow-up.)
- **D-6.** `webhooks/asaas` autentica por `asaas-access-token` nativo, com fallback HMAC legado. O
  fallback ainda é necessário, ou virou superfície extra?

---

## 8. O que JÁ foi auditado — não refaça

Para você não gastar orçamento em terreno pisado. Se achar que algum destes **merece reabertura por
causa das mudanças de ontem**, diga — mas com justificativa:

| Tema | Onde está | Estado |
|---|---|---|
| Idempotência do plan-switch / backstop | `docs/redesenho-upgrade-downgrade.md` | auditado por você, 44/44 testes, validado com dinheiro real |
| Fallback de cartão morto | `docs/plano-implementacao-cartao-morto-2026-07-03.md` | E2E em produção passou |
| Proração (divisor fixo 30) | `docs/briefing-proration-divisor-fixo-30-2026-07-03.md`, `plano-correcao-proration-*.md` | você achou o erro na minha proposta; corrigido e deployado |
| Gating de CPF/CNPJ | `docs/briefing-cpf-cnpj-gating.md` | auditado, P1 corrigido |
| Notificação de lead por WhatsApp | `docs/whatsapp-implementation.md` + RUNBOOK | auditado (P2-2, P2-3) |
| Campos ocultos por URL, condições múltiplas, Sheets | briefings em `docs/` | auditados |
| Auditoria LP Fases 1–4 | `docs/briefing-codex-auditoria-lp-fases-1-4.md` | **sua, de ontem** — correções aplicadas |
| Telefone no cadastro | `docs/briefing-telefone-no-cadastro.md` | escrito, **nunca auditado por você** |

---

## 9. Suspeitas que eu carrego (podem ser paranoia — confirme ou descarte)

Honestidade sobre minhas próprias entregas de ontem:

1. **Minha "verificação ao vivo" foi fraca.** Conferi se strings aparecem no HTML via `curl`.
   Isso não prova que a página renderiza certo, que o JS não quebra, nem que o fluxo funciona.
2. **O gate que unifiquei** virou `PLANS[ownerPlan as PlanName]?.redirect ?? false`. O cast de
   string para `PlanName` é uma mentira ao compilador: se `getEffectivePlan` devolver algo fora do
   enum, cai em `false` (fail-closed, aceitável) — mas **silenciosamente**. Deveria logar?
3. **Telefone obrigatório adiciona atrito no topo do funil**, bem na hora de começar a vender, e
   **o cadastro por Google contorna o campo inteiro** — contas via OAuth ficam sem telefone. Pode
   gerar base inconsistente justo no dado que vai alimentar campanha de WhatsApp.
4. **Não testei o fluxo de login/OAuth depois de mexer no cadastro**, nem o parâmetro `?cycle` que
   o Claude do celular corrigiu **no mesmo arquivo** que eu editei (o merge saiu limpo, mas
   ninguém exercitou o resultado).
5. **Não olhei os logs do crontab da VPS.** Confirmei que os crons existem e estão agendados;
   **não confirmei que estão terminando com sucesso**. Podem estar falhando há dias em silêncio —
   e são justamente os que conciliam pagamento.

---

## 10. Como quero o retorno

1. **Achados classificados por severidade** (P0 bloqueia venda / P1 corrigir antes de escalar /
   P2 dívida), cada um com **arquivo:linha** e **como reproduzir**.
2. **Separe o que é regressão das últimas 24h do que é dívida pré-existente.** Muda quem conserta e
   com que urgência.
3. **Conteste o §9 item por item** — quero saber quais das minhas suspeitas são reais e quais são
   paranoia, porque estou calibrando meu próprio julgamento depois de errar 3× em 24h.
4. **Diga se o recorte de escopo (§2) está errado.**
5. **Uma frase de veredito:** o EidosForm pode começar a vender no estado atual, ou não? Se não,
   qual é a lista mínima de bloqueadores?
