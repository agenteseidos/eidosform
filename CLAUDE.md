# OpenForm

An open-source TypeForm clone built with Next.js 16, Supabase, and Tailwind CSS.

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
2. **Keyboard navigation** - Enter to advance, Arrow keys/scroll wheel to navigate
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

6 presets in `lib/themes.ts`: midnight, ocean, sunset, forest, lavender, minimal

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

### Próximo passo (Sidney, operacional — compras reais, estornar no fim)
1. Conferir que prod NÃO tem `BILLING_MVP_ONLY` nem `BILLING_RECONCILE_*` setados.
2. Compra Starter mensal → `profiles.asaas_card_token` preenchido?
3. Upgrade Starter→Plus → avulso da diferença + sub nova R$127 cheia
   (🚦 GATE P0-2: conferir que a sub nova NÃO gerou cobrança imediata).
4. Downgrade Plus→Starter → R$0 agora, sub nova R$49, saldo vira tempo.
5. Cancelar/estornar/limpar. Tudo ok → está vendendo (sem flags pra virar).

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

### Pendências menores correlatas (não bloqueantes)
- POLISH (decidido 2026-06-10) — modal de sucesso da troca de plano: numa operação
  de R$0 (downgrade/credit_covered) o modal mostra "Pagamento confirmado! / Sua
  assinatura foi ativada". Como não houve cobrança, o texto deve variar conforme o
  caso: troca coberta pelo saldo → algo como "Plano alterado!" / "Seu plano foi
  alterado com sucesso"; só compra/upgrade pago mantém "Pagamento confirmado!".
  Executar DEPOIS de fechar 100% o teste atual. (Componente do overlay de /billing.)
- `ASAAS_ALLOW_HMAC_FALLBACK=0` quando confirmado que prod autentica só pelo
  access-token nativo; depois remover o código do fallback HMAC.
- PIX/Boleto no checkout: decisão de 2026-06-10 = NÃO implementar agora.
- Multi-user: REMOVIDO da oferta em 2026-06-10 (não existe no produto).
- `ADMIN_ALERT_EMAIL`: setar na Vercel (Production) — sem ela os alertas
  operacionais de billing (estorno/cancel falho, DLQ) NÃO são entregues; o log
  acusa em erro alto a cada cold start. Não bloqueia venda, mas é a rede de alertas.
