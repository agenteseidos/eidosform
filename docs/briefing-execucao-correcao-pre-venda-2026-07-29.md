# Briefing de EXECUÇÃO — correção pré-venda do EidosForm

**Data:** 2026-07-29
**Para:** Codex (mesma conversa que produziu a sua auditoria)
**De:** Claude (sessão Claude Code na VPS) + Sidney
**Base:** sua auditoria + a minha, rodadas em paralelo e independentes
**Estado:** `origin/main` = `b07e037`, working tree limpa, produção READY, 701 testes verdes, tsc 0 erros

---

## 0. O que é isto

Você auditou. Eu auditei em paralelo, sem ver o seu resultado. As duas auditorias convergiram no P0 principal
e **divergiram no resto de forma complementar** — você foi mais fundo na infraestrutura (RLS, atomicidade,
build, hidratação), eu fui mais fundo no modelo de negócio (o que é cobrado × o que é prometido). Nenhuma das
duas sozinha dava o quadro completo.

Agora o Sidney quer **execução**. Este documento consolida os dois lados, traz os meus achados que você ainda
não viu, e propõe um plano.

**O plano é uma proposta, não uma ordem.** Quero que você:
1. avalie a viabilidade de cada fase,
2. ajuste o que estiver errado ou mal ordenado — inclusive discordando de mim,
3. e só então implemente.

Se achar que a ordem está errada, ou que alguma correção tem efeito colateral que eu não vi, **diga antes de
mexer**. Já errei três vezes em 24h afirmando coisa falsa com convicção; não quero que você herde meu viés.

---

## 1. Regras do ambiente — leia antes de qualquer comando

**Deploy.** `git push origin main` → a Vercel builda produção sozinha, começa em ~2s. **Mas confirme sempre:**
em 2026-07-28 dois pushes na `main` não geraram deployment nenhum, causa não determinada. Confira com
`vercel ls --token "$(cat /home/sidney/.eidos-credentials/produtos/vercel.token)" --yes | head -4` e valide o
SHA servido. 🚫 **NUNCA `vercel --prod`** — esse comando sobe o diretório local, não a `main`.

**Banco.** **Você NÃO consegue rodar SQL.** Não há `psql` na VPS nem connection string no `.env.production.local`
(só a service-role key, que via PostgREST não executa DDL). Toda mudança de schema/policy tem que ser
**entregue como SQL para o Sidney rodar no SQL Editor do Supabase**. Escreva os arquivos em
`supabase/migrations/` e avise explicitamente o que ele precisa colar e em que ordem.

**Leitura do banco** funciona via PostgREST com a service-role key (`.env.production.local`) — use para
verificar estado antes e depois.

**Qualidade.** Baseline a preservar: `npx vitest run` 701/701 · `npx tsc --noEmit` 0 erros · `npx eslint .`
0 erros (2 warnings pré-existentes de `no-unused-vars`). Build completo estoura o heap padrão — use
`NODE_OPTIONS=--max-old-space-size=4096` (você mesmo descobriu isso).

**Não commite direto sem avisar.** Este repo teve 13 commits de 3 autores diferentes em 24h e uma sessão
publicou sem revisão. Commits pequenos, mensagem explicando o porquê, e **peça o push** ao Sidney ou avise
que vai empurrar.

---

## 2. Achados consolidados

Legenda de status: ✅ verificado em produção · 🔍 lido no código, não verificado ao vivo · ⚠️ precisa de SQL

### P0 — bloqueiam a venda

| # | Achado | Fonte | Status |
|---|---|---|---|
| **P0-1** | Anon lê `forms` inteira: 36 forms, 11 donos, 47 colunas, incl. `webhook_url` (4), `notify_email` (6), `notify_whatsapp_number` (1), `google_sheets_id` (7) | **ambos** | ✅ confirmado pelos dois, independentemente |
| **P0-2** | Policies de INSERT **anônimo** em `responses` e `answer_items` do schema original podem ter sobrevivido (`"Anyone can submit responses to published forms"`, `"Anyone can insert answer items for published forms"`) — as migrations dropam outros nomes | **você** | ⚠️ precisa `pg_policies` |
| **P0-3** | **A cota de respostas não é cobrada no caminho parcial** — ver §2.1 abaixo | **eu** | ✅ estrutural + dado |
| **P0-4** | **Não existe reset mensal** de `responses_used` — a vitrine vende "respostas/mês" | **eu** | ✅ confirmado |

#### 2.1 · P0-3 em detalhe (você não examinou este caminho)

Você verificou que a cota está *correta* (coluna, UI, RPC concordam). Não verificou se ela chega a ser
**cobrada**. Três fatos:

1. `app/api/responses/partial/route.ts` — **zero** chamadas a `checkAndIncrementResponseCount`
   (`grep -c` retorna 0 na rota inteira).
2. `app/api/responses/route.ts:393` — `if (!existingResponseId) { … checkAndIncrementResponseCount … }`.
   Com parcial adotada, `existingResponseId` está preenchido → **o bloco é pulado**.
3. `components/form-player/form-player.tsx:63` —
   `publicPartialEnabled = Boolean(form.google_sheets_enabled)`. Sheets é flag **Starter+**, então todo
   formulário de cliente pagante com Sheets usa o fluxo parcial.

**Dado de produção:** de 1.534 respostas, **1.151 (75%) têm `partial_session_hash`** — passaram pelo caminho
que não cobra.

Consequência: a cota é o **único eixo que separa R$49 de R$257**, e está desarmada justamente nos planos
pagos. Note a simetria com o seu P0-2: os dois terminam em "resposta gravada sem passar pela contagem", um
por bypass de RLS, outro por lacuna de fluxo.

⚠️ *Ressalva honesta:* comparei cota cobrada × respostas reais e a conta Professional deu 108 × 1.463, mas
esse número está contaminado (`responses_used` zera a cada troca de plano, e é a conta de teste de billing).
**A prova é o caminho de código + os 75%, não esse número.** Não use o 108×1463 como argumento.

#### 2.2 · P0-4 em detalhe

Varri todos os crons (`app/api/cron/*`) e as 9 escritas de `responses_used`: o contador só volta a zero em
**evento de plano** (ativação, troca, expiração). Não há job mensal em lugar nenhum.

- **Free:** vitrine diz "100 respostas/mês" → são 100 **para sempre**.
- **Anual:** o reset ocorre no `PAYMENT_CONFIRMED` da renovação → **uma vez por ano**. Um Starter Anual
  (R$348) recebe 1.000 respostas no ano; o mensal recebe 12.000. A página anuncia "/mês" nos dois e destaca o
  anual como economia.

### P1 — corrigir antes de escalar

| # | Achado | Fonte | Status |
|---|---|---|---|
| P1-1 | RPC de cota **não é atômica** (lê, decide, incrementa; sem `FOR UPDATE`) | **você** | 🔍 |
| P1-2 | **Duas contas pagas com `responses_limit=100`** (uma Professional, uma Starter; sem sub Asaas) | **você** | ✅ confirmei |
| P1-3 | Duas migrations do 2026-07-28 redefinem `handle_new_user()` com cotas diferentes; a que grava **50** (`signup_phone_to_profile`) ordena **depois** da que grava 100 (`free_quota_100`) | **eu** | ✅ arquivos conferidos |
| P1-4 | `upload/sign-url` não exige `question_id` nem valida conteúdo/tamanho real; bucket público, sem limpeza de órfãos | **ambos** | 🔍 |
| P1-5 | Leitura do perfil **descarta o `error`** em `partial/route.ts:140` e `responses/route.ts:208` → blip do banco rebaixa pagante a `free`, corta Sheets **e poda respostas de perguntas pagas** (perda de dado), sem log | **eu** | ✅ código conferido |
| P1-6 | Cadastro planta `phone_match_key_br` sem prova de posse (perfil nasce antes da confirmação de e-mail) | **eu** | ✅ (ver §4 divergência) |
| P1-7 | Raiz (indexada) anuncia "tempo médio de resposta", métrica removida do produto | **ambos** | ✅ |
| P1-8 | Intenção de compra se perde no login: middleware grava `?redirect=`, **ninguém lê**; API devolve `/forms` fixo; link "Já tem conta? Entrar" descarta `next`/`cycle` | **eu** | ✅ |
| P1-9 | O teste `analytics/route.test.ts` (escrito ontem) **passa verde com vazamento cross-tenant** — provado por mutação: removendo `.eq('form_id')` os 5 testes continuam passando | **eu** | ✅ mutação |
| P1-10 | Settings mostra preço mensal fixo, ignora `plan_cycle` → assinante anual vê R$257/mês pagando R$197/mês | **ambos** | 🔍 |
| P1-11 | `handleDowngrade` chamado sem `targetPlan` no admin → aplica limite de Free num downgrade para Starter (pausa formulários) | **eu** | 🔍 |
| P1-12 | Reversão por expiração: cron zera `responses_used`, `plan-features` **não** → corrida decide se o cliente fica com 100 grátis ou **travado para sempre** (`used` 12.000 > `limit` 100) | **eu** | 🔍 |
| P1-13 | Cancelar+reativar mesmo plano custa R$0 e **zera `responses_used`** → respostas ilimitadas em loop | **eu** | 🔍 |

### P2 — dívida

`/v2` ainda promete o alerta de 80% (página órfã, noindex) · fallback HMAC ligado por padrão · gates pagos por
string (12 dos 78 importam) · `createPublicClient` é service_role e o nome engana em ~30 call sites ·
`forms/[id]/plan` é rota pública sem uso (código morto) · painel de WhatsApp: âmbar virou estado absorvente
(alerta de abandono nunca fica vermelho) · rate limit do signup chaveado pelo e-mail (sem teto por IP/global) ·
16 de 18 contas sem telefone e OAuth Google não coleta.

---

## 3. ⚠️ Dependência crítica que nenhuma das duas auditorias transformou em restrição de ordem

**Fechar a leitura anônima de `forms` QUEBRA o domínio personalizado** — recurso exclusivo do Professional.

`middleware.ts:81` e `:92` resolvem domínio customizado fazendo `fetch` direto ao PostgREST **com a
`NEXT_PUBLIC_SUPABASE_ANON_KEY`**, lendo `custom_domains` e depois `forms`. Hoje isso só funciona porque as
policies permissivas existem. Removê-las sem tratar o middleware transforma um vazamento de dados numa
indisponibilidade do recurso mais caro.

**Isto tem que ser resolvido na MESMA entrega**, não depois. Opções que enxergo (escolha a sua):
- migrar o middleware para service-role (verificar disponibilidade da env no Edge runtime), ou
- expor um RPC `SECURITY DEFINER` que devolve **só** `slug`+`status` para um hostname verificado, ou
- usar a view `published_forms` que já existe (`20260430`) e nunca foi ligada em lugar nenhum.

Verifique também se `custom_domains` tem hoje **0 linhas** (eu confirmei que sim) — isso significa que o
recurso está sem uso e você tem folga para mexer sem impacto imediato, mas o Sidney vende Professional.

---

## 4. Divergência entre nós — resolva você

**Gravidade da colisão de telefone (P1-6).** Você concluiu "falha fechado como `unknown`, não sequestra conta".
Isso vale quando a vítima **já tem** conta (2 perfis → `unknown`). Mas quando a vítima **não tem** conta, o
atacante planta o único perfil e `decidirEstadoConta` devolve `free` em vez de `none` — a Elen trata lead
virgem como quem já se cadastrou. São dois cenários; você avaliou um.

Existe **1 chave de telefone duplicada no banco hoje** (`558399376704`, 2 perfis) — provavelmente benigna
(contas do próprio Sidney), mas é o mecanismo funcionando.

Correção que me parece mais barata: no consumidor (`buscarProfiles`), ignorar perfis cujo
`auth.users.email_confirmed_at` seja nulo. Avalie.

---

## 5. Plano que eu implementaria — critique e ajuste

### Fase 0 — Diagnóstico (SQL para o Sidney rodar; minutos, sem mudança)

Nada de código antes disto. Duas consultas decidem o escopo real:

```sql
-- (a) Estado REAL das policies — decide se o seu P0-2 é teórico ou vivo
SELECT tablename, policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname='public' AND tablename IN ('forms','responses','answer_items','custom_domains','profiles')
ORDER BY tablename, policyname;

-- (b) Qual versão do trigger está viva — decide se o P1-3 já explodiu
SELECT pg_get_functiondef('public.handle_new_user'::regproc);
```

Peça ao Sidney e **espere o resultado**. Ele responde rápido.

### Fase 1 — Fechar o vazamento (P0-1 + P0-2) — a mais urgente

1. Migrar o middleware para não depender de leitura anônima (§3). **Primeiro**, ou junto.
2. Migration única, idempotente, que dropa as policies antigas **pelos nomes exatos** que a Fase 0 revelou —
   `forms`, `responses`, `answer_items`, `custom_domains` — e revoga grants anônimos de escrita.
3. Manter o player público funcionando: ele usa `createPublicClient` (service_role, bypassa RLS), então
   **não deve** ser afetado — confirme.
4. **Teste pós-deploy obrigatório**, com a anon key, provando que `forms` passou a negar e que
   `/f/<slug>`, o envio de resposta e o domínio personalizado continuam funcionando.

### Fase 2 — Cota (P0-3 + P0-4) — ⚠️ **depende de decisão do Sidney, ver §6**

Depois que ele decidir o significado de "respostas/mês":

- Cobrar a cota no caminho parcial→final. Onde cobrar (na criação da parcial? na adoção? no submit final?) é
  desenho seu — considere que a parcial é anônima e que cobrar cedo demais penaliza abandono.
- Tornar a RPC atômica (seu P1-1) — `UPDATE ... WHERE responses_used < responses_limit RETURNING` me parece
  mais simples que `FOR UPDATE`, mas você decide.
- Implementar reset mensal, **se** for essa a decisão.
- Fechar P1-12 e P1-13 juntos — são o mesmo tema (quando o contador zera e por quê).

### Fase 3 — Consistência de dados e migrations

- Reconciliar as duas migrations do trigger (P1-3): uma versão só, valor derivado de uma fonte, e uma nota
  explicando por que existem duas.
- Corrigir as duas contas pagas com cota 100 (P1-2) — SQL para o Sidney, com `RETURNING` para deixar trilha
  (a migration de ontem não deixou, e isso foi apontado pelos dois).

### Fase 4 — P1s de código (independentes entre si, podem ir em paralelo)

P1-5 (tratar o `error` da leitura de perfil — **o de maior risco aqui**, perde dado do cliente) · P1-7 (copy da
raiz) · P1-8 (intenção de compra no login) · P1-9 (refazer o teste de analytics para pegar o que ele deixa
passar) · P1-4 (`question_id` no sign-url) · P1-10 (preço em Settings) · P1-11 (`targetPlan` no admin) ·
P1-6 (colisão de telefone, conforme §4).

### Fase 5 — P2s

Só depois. Nenhum bloqueia venda.

---

## 6. Decisões que são do SIDNEY, não suas nem minhas

Não decida sozinho; pergunte e espere:

1. **O que "respostas/mês" significa.** Reset mensal de verdade? Ou a vitrine passa a dizer outra coisa? Isso
   muda o produto e o preço — é decisão de negócio. **A Fase 2 inteira depende dela.**
2. **Cobrar a cota retroativamente ou não** dos formulários que hoje passam sem contar. Há clientes com
   volume acumulado; ligar a contagem pode bloquear alguém amanhã.
3. **As duas contas pagas com cota errada** — são concessões manuais dele. Elevar para o valor do plano ou
   manter como estão?
4. **Domínio personalizado:** aceitar breve indisponibilidade durante a Fase 1 (hoje há 0 domínios
   configurados, então o risco é nulo agora) ou exigir zero downtime?

---

## 7. O que NÃO fazer

- **Não refaça a auditoria do billing.** Idempotência do plan-switch, fallback de cartão morto e proração já
  foram auditados por você e testados com dinheiro real em produção. Mexa neles só se uma correção exigir.
- **Não mexa em `/v3` e `/v4` como se uma fosse ser descartada** — o Sidney decidiu que **ambas vão ao ar**,
  o teste A/B continua, e a raiz ainda não foi escolhida.
- **Não "arrume" o telefone no cadastro tornando-o opcional** sem falar com ele — foi decisão explícita dele
  ontem, com objetivo de campanha de WhatsApp.
- **Não toque no alerta de 80%** — a promessa foi removida da vitrine de propósito; a decisão registrada é
  não investir na confiabilidade dele agora (plateia: 3 contas, zero perto do limite).
- **Não rode `vercel --prod`**, e não conclua "está no ar" sem conferir o SHA servido.

---

## 8. O que quero de volta

1. **Sua avaliação do plano antes de executar** — o que está errado, mal ordenado, ou tem efeito colateral
   que eu não vi. Especialmente a §3 (middleware × domínio personalizado) e a Fase 2.
2. **Confirmação ou refutação do P0-3** (cota não cobrada). Você não olhou esse caminho; se eu estiver errado,
   quero saber antes de o Sidney tomar decisão de produto em cima disso.
3. Execução por fases, com **teste pós-deploy real** em cada uma (não "deploy Ready" — prova de comportamento).
4. Ao final, o **estado de cada item** desta lista: corrigido / adiado com motivo / discordo e por quê.
