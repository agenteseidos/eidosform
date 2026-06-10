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


## ⏳ PENDÊNCIA ATIVA — Billing/Asaas: tokenização e cadeia de destrave

> Registrado em 2026-06-10 (decisão Sidney). Esta é a ÚNICA pendência externa
> bloqueante do projeto. Detalhes completos: `docs/redesenho-upgrade-downgrade.md`.

### Estado atual (seguro, fail-closed)
- O billing em produção atende SÓ **primeira compra (free→pago) do Starter MENSAL**.
- Tudo o mais (upgrade, downgrade, troca de ciclo, anual, Plus/Professional na
  primeira compra) está travado pelo launch guard (`lib/billing-launch-guard.ts`,
  `BILLING_MVP_ONLY` ON por padrão) e retorna 409 com mensagem amigável.
- Motivo: o Asaas de PRODUÇÃO bloqueia alterar valor de assinatura-cartão já paga
  (`400 invalid_value`) — qualquer fluxo que edita valor (proration, Caminho D,
  auto-correção) cobraria errado. O sandbox NÃO reproduz esse bloqueio.

### Bloqueador externo (fora das nossas mãos)
- **Tokenização de cartão em produção** — protocolo Asaas **1238651**, aguardando
  liberação. Sem `creditCardToken` retornado em prod, não há como "cancelar +
  recriar" assinatura, que é o único modelo válido de mudança de plano.
- Também aguardando resposta do Asaas (chamado aberto): a regra de
  `invalid_value` vale para downgrade? Existe alternativa oficial?

### Cadeia de destrave QUANDO a tokenização ligar (nesta ordem)
1. **Implementar** o redesenho cancelar+recriar via token
   (`docs/redesenho-upgrade-downgrade.md` é PROJETO, não implementação):
   upgrade = diferença como pagamento avulso → no webhook de confirmação,
   cancelar sub antiga + criar nova no preço CHEIO com `creditCardToken` e
   `nextDueDate` = fim do ciclo pago. Downgrade/ciclo: mesma ideia.
   NÃO usar `discount` nem edição de valor (provado que falha em prod).
2. **Testar em produção** com o plano de teste do doc: compra Starter →
   upgrade Starter→Plus (recorrente deve ficar R$127) → downgrade Plus→Starter
   (recorrente R$49, saldo vira tempo) → cancelar/estornar/limpar.
3. **Virar as flags**, uma de cada vez, validando entre elas:
   `BILLING_MVP_ONLY=false` → `BILLING_ALLOWED_PLANS=starter,plus,professional`
   → liberar ciclo anual → `BILLING_RECONCILE_ACTIONS=true` (crons saem do
   modo alert-only).

### O que JÁ existe e deve ser REUSADO (não reimplementar)
- Captura do `creditCardToken` pós-ativação → `profiles.asaas_card_token`
  (`lib/billing-activation.ts`).
- Reativação via token (caminho `credit_covered` no checkout) — padrão de
  referência de "criar sub nova com token salvo" (`app/api/checkout/[plan]/route.ts`).
- Idempotência, guards out-of-order, DLQ e reconcile crons do webhook Asaas.

### Pendências menores correlatas (não bloqueantes)
- `ASAAS_ALLOW_HMAC_FALLBACK=0` quando confirmado que prod autentica só pelo
  access-token nativo; depois remover o código do fallback HMAC.
- PIX/Boleto no checkout: decisão de 2026-06-10 = NÃO implementar agora
  (timing de confirmação diferente exigiria re-testar todo o webhook).
- Multi-user: REMOVIDO da oferta em 2026-06-10 (não existe no produto).
  Se um dia for implementado, reintroduzir na pricing page + `maxUsers`.
