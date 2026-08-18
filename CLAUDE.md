# OpenForm

An open-source TypeForm clone built with Next.js 16, Supabase, and Tailwind CSS.

---

## 🛑 REGRA Nº 1 — O REPOSITÓRIO NÃO DESCREVE O BANCO

**A tabela `supabase_migrations.schema_migrations` EXISTE desde 11/08/2026** (criada na sessão
D-03, com RLS e revoke) — mas cobre SOMENTE o que foi registrado dali em diante. Todo o histórico
ANTERIOR segue sem registro: migrations foram aplicadas manualmente por meses, sem rastro.
Consequência comprovada: **os arquivos `.sql` divergem do banco real.** ⚠️ REGRA OPERACIONAL: toda
mudança pelo SQL Editor leva o `insert` de registro NA MESMA execução (receita na ficha D-03 de
`docs/demandas-futuras.md`) — mudança sem registro recria o problema que esta regra existe para matar.

**NUNCA afirme nada sobre o estado do banco lendo `supabase/migrations/*.sql`, `schema.sql` ou
`schema_eidosform.sql`. SEMPRE consulte o catálogo** (`pg_proc`, `pg_policies`, `pg_indexes`,
`pg_views`, `information_schema.role_table_grants`, `information_schema.column_privileges`)
pelo **SQL Editor do painel Supabase**.

> ⚙️ Nesta VPS não há `psql`, Supabase CLI nem connection string. O cliente PostgREST (mesmo com
> service-role) **não executa DDL/GRANT**. Toda mudança de permissão ou estrutura passa pelo SQL
> Editor, com o Sidney rodando. Planeje isso ao propor correções de banco.

### Cinco casos reais (06 e 07/08/2026) — e todos invisíveis à leitura de código

| # | O que o repositório dizia | O que o banco tinha |
|---|---|---|
| 1 | migration `20260430` de `profiles` abortava, deixando plano desprotegido | **Aplicada.** Policy existe, proteção por coluna de pé — achado da auditoria REFUTADO |
| 2 | `REVOKE EXECUTE ... FROM PUBLIC` nas funções `SECURITY DEFINER` | **Não estava em vigor.** `anon` executava as 8 — travar cadastro e queimar cota alheia, sem login |
| 3 | `check_and_increment_response(uuid)` | Assinatura real tem **2 parâmetros** — SQL montado pelo arquivo falhou com `42883` |
| 4 | (nada — invisível no código) | `GRANT` amplo ao `anon` em **14 tabelas + a view `published_forms`**, que é auto-atualizável e roda com `security_invoker=false`: havia caminho para **alterar/apagar formulário publicado de qualquer cliente sem login** |
| 5 | `get_response_counts_by_forms` = `COUNT(*)` puro (migration `20260428`) | Tem uma **guarda de propriedade** que o arquivo não tem (`auth.uid() IS NULL OR EXISTS(... f.user_id = auth.uid())`). Confirmado em 07/08/2026 lendo `pg_proc.prosrc`. Não muda o resultado para quem chama com service-role, mas prova de novo que o `.sql` é a versão de ontem |

**O caso 4 é o que mais importa como lição.** Uma auditoria de 30 lotes e 85 mil linhas, com dois
modelos e passe duplo adversarial, **não o encontrou** — porque ele não existe em lugar nenhum do
código. Risco de configuração e de estado do banco é estruturalmente invisível à revisão de código.

**Receita para `GRANT`/`REVOKE`:** use bloco `DO` que descobre a assinatura real
(`p.oid::regprocedure`) e aplica por OID — imune a divergência e a sobrecargas. E lembre que
**views não aparecem em `pg_tables`**: varra `pg_views` também (foi assim que o caso 4 quase escapou).

_Registro completo: `eidos-shared/auditoria-geral-2026-08/99-sintese/lote-1-execucao.md`_

---

## Tech Stack

- **Next.js 16** (App Router) with React 19
- **Supabase** for auth (Google OAuth + Magic Link) and PostgreSQL database
- **Tailwind CSS v4** + **shadcn/ui** for styling
- **Framer Motion** for animations
- **Cloudflare R2** for file uploads (optional)

## Project Structure

```
app/
├── (auth)/           # Login page (public)
├── (dashboard)/      # Protected: dashboard, form builder, responses, settings
├── api/upload/       # R2 file upload endpoint
├── auth/callback/    # Supabase OAuth callback
├── f/[slug]/         # Public form player (excluded from auth middleware)
components/
├── dashboard/        # Nav, form cards, delete button
├── form-builder/     # FormBuilder, QuestionEditor, FormPreview
├── form-player/      # FormPlayer, QuestionRenderer
├── responses/        # ResponsesDashboard (table view, CSV export)
├── ui/               # shadcn/ui primitives
lib/
├── supabase/         # client.ts (browser), server.ts (RSC), middleware.ts
├── database.types.ts # TypeScript types matching Supabase schema
├── questions.ts      # Question type definitions and factory
├── themes.ts         # 6 theme presets with CSS variable generation
```

## Core Patterns

### Supabase Client Usage

```typescript
// Server Components / Route Handlers
import { createClient } from '@/lib/supabase/server'
const supabase = await createClient()

// Client Components  
'use client'
import { createClient } from '@/lib/supabase/client'
const supabase = createClient()
```

### Database Schema

Three tables with Row Level Security (RLS):

- **profiles** - User data (auto-created via trigger on auth.users insert)
- **forms** - Form config with JSONB `questions` array, theme preset, status (draft/published/closed)
- **responses** - JSONB `answers` keyed by question ID

### TypeForm UX Principles

The form player (`form-player.tsx`) implements TypeForm's signature experience:

1. **One question at a time** - Full-screen focus with animated transitions
2. **Keyboard navigation** - Enter to advance, Arrow keys to navigate. **Não há navegação por roda
   do mouse** — foi removida (`form-player.tsx`, comentário "Wheel navigation removido"). Esta
   linha dizia que havia e fez uma auditoria caçar guarda de scroll que não existe.
   Exceção: na pergunta `calendly` sem agendamento, Enter e ↓ NÃO avançam (ver `getAdvanceControls`)
3. **Progress indicator** - Top bar showing completion percentage
4. **Themed experience** - Dynamic CSS variables from theme config
5. **Validation** - Per-question with type-specific rules (email, URL, phone patterns)

### Question System

13 question types defined in `lib/questions.ts`. Each has:
- Type identifier (snake_case: `short_text`, `opinion_scale`, etc.)
- Label, description, icon (Lucide)
- Default config (placeholder, options, min/max values)

Add new types by:
1. Add to `QuestionType` union in `database.types.ts`
2. Add entry to `questionTypes` array in `questions.ts`
3. Add renderer case in `question-renderer.tsx`

### Theme System

7 presets in `lib/themes.ts`: midnight, ocean, sunset, forest, lavender, minimal, terracota

Each theme defines: `primaryColor`, `backgroundColor`, `textColor`, `accentColor`, `fontFamily`

Use `getThemeCSSVariables()` to apply as inline CSS custom properties.

## Key Conventions

- **'use client'** only where needed (interactivity, hooks, browser APIs)
- **Server Components** for data fetching and auth checks
- **Route groups** `(auth)` and `(dashboard)` for layout organization
- **Form state** uses React `useState` - no external form library for simple cases
- **Toast notifications** via `sonner` (`toast.success()`, `toast.error()`)
- **Animations** use Framer Motion's `motion` components with `AnimatePresence`
- **Reorderable lists** use `framer-motion`'s `Reorder` component

## Auth Flow

1. User visits `/login` → Google OAuth or Magic Link
2. Supabase redirects to `/auth/callback` → exchanges code for session
3. Middleware (`lib/supabase/middleware.ts`) refreshes session on protected routes
4. Dashboard layout checks auth, redirects to `/login` if unauthenticated

## Public Forms

Forms at `/f/[slug]` are excluded from auth middleware. They:
- Fetch published forms via Supabase with RLS policy allowing public read
- Submit responses without authentication
- Display "not found" for unpublished/missing forms

## File Uploads

Configure R2 env vars to enable. Upload endpoint at `app/api/upload/route.ts` returns public URL stored in answers JSONB.

## Commands

```bash
npm run dev      # Development server (localhost:3000)
npm run build    # Production build
npm run lint     # ESLint
```


## ⏳ PENDÊNCIA ATIVA — Billing/Asaas: teste único de produção da troca de plano

> Atualizado em 2026-06-10 (sessão 2): código alinhado p/ VENDA 100% por decisão do
> Sidney — sem rollout gradual. Kill-switch OFF por padrão, todos os planos/ciclos
> liberados, reconcile com ação ligada. O que falta é só o teste único em produção
> (compras reais, estornar no fim). Roteiro: `docs/redesenho-upgrade-downgrade.md`.

### Estado atual
- Código do redesenho COMPLETO e no ESTADO FINAL DE VENDA: `lib/plan-switch.ts`
  (executor + backstop), `createPaymentWithToken`/`refundPayment` em `lib/asaas.ts`,
  orquestração no checkout, gancho no webhook (`kind:planchange`), retry na DLQ.
  Nenhum fluxo edita valor de assinatura.
- Caminho D antigo (editar sub) e proration-checkout (customValue) REMOVIDOS.
- `BILLING_MVP_ONLY` virou KILL-SWITCH: OFF por padrão, liga só com `=true` explícito
  (emergência). `BILLING_RECONCILE_*` ações ON por padrão (desliga com `=false`).
  Produção NÃO deve ter essas vars setadas.
- P2-1 (crédito no anual) DECIDIDO: crédito = desconto no fluxo pago; vira tempo só
  quando cobre o preço inteiro. Transparente via preview. Sem mudança de código.
- Captura do token loga AUSÊNCIA explicitamente (validação conclusiva).
- MODELO DE CRÉDITO JUSTO (decisão Sidney 2026-06-10, sessão 3 — "dias pagos são o
  ativo"): teto `min(crédito, preço)` REMOVIDO de `calculateProrationCredit`; contagem
  em dias INTEIROS de calendário BRT (`remainingPaidDays`/`addDaysToTodayBRT` em
  `lib/proration.ts`). Reativação de MESMO plano+ciclo = identidade exata (cobertura =
  dias restantes; cancel+reativa N vezes NÃO move a data — anti-farming por construção,
  o teto ficou desnecessário). Entre planos, ceil concede ≤1 dia por conversão (decisão
  antiga, favorece o cliente) e a ida-e-volta converge. Motivo: no teste de produção a
  reativação clipou 78 dias pagos → 30 (perda ~R$78 do cliente).

### ✅ BILLING NO AR — teste de produção + limpeza CONCLUÍDOS (2026-06-10)
Passos validados com compras reais: (1) compra Starter mensal + token capturado;
(2) upgrade Starter→Plus — avulso R$78 + sub nova R$127 cheia, GATE P0-2 PASSOU (sem
cobrança imediata); (3) downgrade Plus→Starter — R$0, saldo virou tempo (27/08);
(4) cancelamento — soft-cancel ok, UI corrigida (ciclo no título + msg de cancelado);
(5) reativação — R$0, sub recriada via token (`reactivate` validado). ESTÁ VENDENDO.
Também validado o MODELO DE CRÉDITO JUSTO no fluxo real (Starter→Plus coberto por saldo
R$0 → cancel → Plus→Starter R$0 com modal "Plano alterado!"). **Limpeza FEITA:** estornados
R$49 + R$78, sub deletada, profile de teste resetado p/ free no Supabase (lembrete: o reset
usa `plan_status='active'`, NÃO null — a coluna é NOT NULL DEFAULT 'active'; free legítimo =
plan 'free' + status 'active').

### 🔜 PRÓXIMA FEATURE (decidida 2026-06-10) — Fallback: troca de plano com cartão salvo MORTO
> Cenário: cliente quer upgrade PAGO mas o `asaas_card_token` salvo expirou/foi
> recusado/cartão virtual de 24h (ou nunca teve token — pré-tokenização). Hoje o
> fluxo é fail-closed e devolve `CHARGE_FAILED`/`CARD_TOKEN_REQUIRED` mandando "fale
> com o suporte" — e NÃO existe tela de atualizar cartão. Lacuna real ("quero te
> pagar e não consigo").
>
> **Solução escolhida (Sidney): abrir o checkout hospedado do Asaas cobrando SÓ a
> diferença como pagamento AVULSO (one-time, chargeTypes DETACHED), capturar o cartão
> NOVO, e seguir o MESMO fluxo interno — sub recriada no preço CHEIO via token novo +
> cancel da antiga (`executePlanSwitch`/backstop).** NÃO é a volta do `customValue`
> removido: aquele criava a SUB recorrente no valor prorateado (quebra em prod). Aqui
> o avulso é único; a recorrência nasce sempre cheia. Isso mata a armadilha sem perder
> a ergonomia do sandbox.
>
> Reusa ~80%: `executePlanSwitch`, `runPlanChangeBackstop`, linha `recovering` em
> `billing_checkouts`, polling `/api/checkout/status`, captura de token no webhook.
> Bônus: resolve de quebra o assinante pré-tokenização.
>
> **2 confirmações com o gateway ANTES de codar o caminho todo (gates da arquitetura):**
>  1. Correlação SEM `externalReference`: o checkout hospedado NÃO persiste o
>     externalReference (achado `lib/asaas.ts:172`, vem null) → o marcador
>     `kind:planchange` se perde. Precisa casar o pagamento à troca pendente por
>     OUTRO fio (id da sessão de checkout salvo na linha de recuperação + lookup no
>     webhook).
>  2. Token no avulso: confirmar via SMOKE TEST que um pagamento ÚNICO por cartão no
>     checkout hospedado devolve `creditCardToken` reutilizável (no recorrente devolve;
>     no avulso é incerto). Se NÃO devolver, o desenho muda — descobrir isto PRIMEIRO.
> Esforço: ~1 sessão + smoke. Risco no dinheiro: baixo (fail-closed; não pago = nada muda).
> Sequência acordada: terminar o teste atual → smoke do ponto 2 → implementar.

## ✅ AUDITORIA LP × CÓDIGO — Fases 1–4 EXECUTADAS (2026-07-28)

> Registro completo: `docs/auditoria-lp-2026-07-28.md`. Resumo: vazamentos de
> gating estancados (redirect Starter+, Sheets parcial, alerta 80% religado
> Plus+, crons agendados), vitrine de planos virou FONTE ÚNICA
> (`lib/plan-marketing.ts` + teste que quebra em promessa sem lastro), tela de
> abandono por pergunta criada (analytics-panel), UTM agora chega em webhook e
> WhatsApp, e a copy das /v3 e /v4 foi alinhada ao produto real (CAPI
> server-side, campos ocultos, seção própria de WhatsApp, 20 tipos/11
> templates). REGRA NOVA: nunca redigitar lista de plano em componente —
> importar de `lib/plan-marketing.ts`.
>
> Pendente: promover v3 OU v4 à raiz (aguarda A/B — decisão 0.1); depoimentos
> seguem placeholder (decisão 0.4).
>
> ✅ **CRONS RESOLVIDO (2026-07-28, revisão Codex).** NÃO é preciso Vercel Pro. A
> conta é Hobby (máx. 2 crons, só diários) e os 5 jobs JÁ tinham agendador: o
> `vercel.json` volta a ter SÓ `expire-plans` (diário); `reconcile-checkouts`,
> `sweep-received` e `reconcile-subscriptions` rodam de hora em hora no crontab
> da VPS; `abandoned-leads` roda no timer systemd `eidosform-abandoned.timer` a
> cada 15 min. **O timer duplicado EXISTIA** (o handoff dizia que não) — os 4
> crons sub-diários foram revertidos. Tabela em `DEPLOY.md`.
>
> ⚠️ **NÃO ANUNCIAR (promessas sem lastro, revisão Codex 2026-07-28)** — removidas
> das /v3 e /v4:
> - ~~**CAPI server-side**~~ ✅ **RESOLVIDO EM 18/08/2026 — PODE ANUNCIAR.** O que
>   havia: UM `META_PIXEL_ID`/token GLOBAL da plataforma, enquanto os pixels dos
>   clientes são POR FORMULÁRIO — ou seja, o e-mail/telefone hasheados do lead do
>   CLIENTE iam para o NOSSO ativo do Meta e a conversão dele nunca chegava. Além
>   disso todo evento saía como `Lead` e o `event_id` era o NOME do evento (sem
>   dedup real com o browser → conversão contada em dobro).
>   Agora: pixel **e token por formulário** (`form_capi_credentials`, cifrado
>   AES-256-GCM, tabela fora de `forms` porque `forms.pixels` viaja para o navegador
>   do visitante), **sem fallback global** (`decidirEnviosCapi`, testado contra a
>   volta do fallback), **nome real do evento** e **`eventID` compartilhado** entre
>   fbq e servidor. `META_PIXEL_ID`/`META_ACCESS_TOKEN`/`META_TEST_EVENT_CODE` não
>   são mais lidos por nenhum código — **remover da Vercel**. Nova var obrigatória:
>   `META_CAPI_ENC_KEY` (32 bytes hex, sem fallback: ausente = save recusado).
> - **"UTM na mensagem do WhatsApp por padrão"**: as variáveis `{utm_*}` existem,
>   mas os templates PADRÃO não as usam. (O bug de perda de UTM na revalidação do
>   abandono FOI corrigido.)
> - **"pergunta exata onde desistiu"** → o dado é a última pergunta RESPONDIDA;
>   copy corrigida para "após qual pergunta parou".
> - **"tempo médio de preenchimento"**: `responses` não tem timestamp de início
>   (só `submitted_at`/`last_activity_at`); o endpoint consultava
>   `created_at`/`updated_at`, que NÃO EXISTEM. Métrica removida da UI e do
>   endpoint até existir coluna de início (SEM default — vide 2026-07-23).
>
> ✅ **COTA DO FREE = 100** (decisão Sidney 2026-07-28). O trigger gravava 50 e a
> RPC `check_and_increment_response` RESPEITA `profiles.responses_limit` — conta
> nova era bloqueada em 50 com a LP vendendo 100. Migração
> `20260728_free_quota_100.sql` corrige o trigger e regulariza os perfis free.

### Pendências menores correlatas (não bloqueantes)
- ✅ POLISH FEITO (2026-06-10, sessão 3) — modal de sucesso da troca de plano: operação
  R$0 (coveredByCredit) agora redireciona p/ `?checkout=plan_changed` → overlay "Plano
  alterado!" sem polling (a troca é síncrona). Só pagamento real mantém o fluxo
  `?checkout=success` / "Pagamento confirmado!".
- `ASAAS_ALLOW_HMAC_FALLBACK=0` quando confirmado que prod autentica só pelo
  access-token nativo; depois remover o código do fallback HMAC.
- **PIX/Boleto: NUNCA.** Decisão de 2026-06-10, reafirmada sem margem em 15/08/2026 ("não vamos
  ter pix ou boleto, se tiver isso em algum lugar remova, só cartão"). O EidosForm vende
  assinatura recorrente por CARTÃO. Não é "ainda não" — é não. Travado por
  `lib/asaas.somente-cartao.test.ts`, que quebra se algum caminho declarar outro billingType,
  e por teste de copy que varre os 6 estágios da régua. Registro: `decisoes/decisions.md`.
- Multi-user: REMOVIDO da oferta em 2026-06-10 (não existe no produto).
- ✅ `ADMIN_ALERT_EMAIL`: **JÁ CONFIGURADA** — conferido via API da Vercel em 2026-07-29:
  `sidney@institutoeidos.com.br`, nos 3 ambientes (production/preview/development).
  A memória do vault já registrava isso desde 2026-06-15 (o "faltando" original era
  artefato do ambiente LOCAL de quem auditou, não da produção). Esta linha ficou
  desatualizada aqui e fez o Claude reportar ao Sidney uma pendência inexistente em
  29/07 — não reabrir. Para reconferir: `GET /v9/projects/eidosform/env`.
