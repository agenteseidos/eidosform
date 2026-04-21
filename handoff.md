## Handoff — Toin (Fix Auth Redirects) — 2026-04-21 18:43 GMT-3

### O que foi feito
- Corrigidos 2 bugs de redirect apontando pra `/billing` → `/forms`
- Commit `0bf0a19` — `fix: auth redirects /billing→/forms (callback + middleware)`
- Push para origin/main

### FIX 1 — Auth callback default redirect
- **Arquivo:** `app/auth/callback/route.ts`
- L5: `?? '/billing'` → `?? '/forms'`
- L7: fallback `/billing` → `/forms`

### FIX 2 — Middleware redirect pós-login
- **Arquivo:** `lib/supabase/middleware.ts`
- L91: `url.pathname = '/billing'` → `url.pathname = '/forms'` (bloco `/login` + user logado)

### Arquivos alterados
- `app/auth/callback/route.ts` — 2 linhas
- `lib/supabase/middleware.ts` — 1 linha

### Pendências
- Nenhuma

---

## Auditoria Zéfa — commit ea28c21 — 2026-04-21 18:41 GMT-3

### Resultado: ❌ REPROVADO (2 bugs P1)

**✅ Itens auditados OK:**
- Nav links: logo, desktop, dropdown, mobile → `/forms`. Upgrade/billing → `/billing`.
- Cycle checkout: mapeamento `annual → yearly` correto. API aceita `monthly` e `yearly`.
- Middleware: `/forms` protegido corretamente.

**❌ Bugs P1 encontrados:**
1. `app/auth/callback/route.ts` L5 — default redirect `/billing` → deveria ser `/forms`
2. `lib/supabase/middleware.ts` — redirect de `/login` (já logado) pra `/billing` → deveria ser `/forms`

---

## Handoff — Toin (Fix Nav Links + Cycle Checkout) — 2026-04-21 18:40 GMT-3

### O que foi feito
- Corrigidos 2 bugs: nav links apontando pra /billing e cycle anual no checkout Asaas
- Commit `ea28c21` — `fix: nav links /billing→/forms + cycle annual→yearly no checkout`
- Push para origin/main

### BUG 1 — Nav: logo e "Meus Formulários" apontando pra /billing
- **Arquivo:** `components/dashboard/nav.tsx`
- Logo href `/billing` → `/forms`
- Link desktop "Meus Formulários" `/billing` → `/forms`
- Dropdown "Meus Formulários" `/billing` → `/forms`
- Link mobile "Meus Formulários" `/billing` → `/forms`
- **NÃO alterado:** Upgrade, Planos & Cobrança, Fazer upgrade (corretamente em `/billing`)

### BUG 2 — Checkout Asaas: cycle annual→yearly
- **Arquivo:** `components/billing-plans.tsx`
- `?cycle=${billing}` → `?cycle=${billing === 'annual' ? 'yearly' : billing}`
- State interno continua usando 'annual', mapeamento só na URL

### Arquivos alterados
- `components/dashboard/nav.tsx` — 4 links corrigidos
- `components/billing-plans.tsx` — 1 linha (mapeamento de ciclo)

### Pendências
- Nenhuma
## Handoff — Toin (Fix Responsividade ETAPA 6 Admin + Responses) — 2026-04-09 17:28 GMT-3

### O que foi feito
- Corrigidos bugs de responsividade no Admin Panel e tela de Responses
- `npx tsc --noEmit` passou sem erros

### Componentes verificados
- `app/(admin)/admin/layout.tsx` — layout admin com sidebar
- `components/admin/admin-users-table.tsx` — tabela de usuários
- `components/admin/admin-metrics-cards.tsx` — grid de métricas
- `components/admin/admin-whatsapp-panel.tsx` — WhatsApp panel
- `components/responses/responses-dashboard.tsx` — dashboard de respostas
- `app/(admin)/admin/page.tsx` — página admin principal
- `app/(admin)/admin/whatsapp/page.tsx` — página WhatsApp admin
- `app/(dashboard)/forms/[id]/responses/page.tsx` — página de respostas

### Correções aplicadas

| Item | Antes | Depois | Arquivo |
|---|---|---|---|
| Main padding | `px-6 py-8` fixo | `px-4 py-6 sm:px-6 sm:py-8` | `admin/layout.tsx` |
| Header padding | `px-6` fixo | `px-4 sm:px-6` | `admin/layout.tsx` |
| Users table | sem overflow-x-auto | `overflow-x-auto -mx-6 px-6` wrapper | `admin-users-table.tsx` |
| Coluna "Nº forms" | sempre visível | `hidden sm:table-cell` | `admin-users-table.tsx` |
| Botão "Alterar plano" | sem size/touch target | `size="sm" min-h-[44px]` | `admin-users-table.tsx` |
| QR code | `w-64 h-64` fixo | `w-56 h-56 sm:w-64 sm:h-64` | `admin-whatsapp-panel.tsx` |
| Botão "Gerar QR" | sem min-height | `min-h-[44px] justify-center` | `admin-whatsapp-panel.tsx` |
| Logs layout | `items-center justify-between` | `items-start sm:items-center gap-2 min-w-0` | `admin-whatsapp-panel.tsx` |
| Logs texto | sem truncate | `truncate` + `whitespace-nowrap flex-shrink-0` | `admin-whatsapp-panel.tsx` |
| Status/Date selects | `w-40` fixo | `w-full sm:w-40` | `responses-dashboard.tsx` |

### Itens verificados e OK (sem alteração necessária)
- **Admin sidebar** — já tem nav mobile (`lg:hidden` no header) ✅
- **Metrics cards grid** — Tailwind default `grid-cols-1` como base ✅
- **Responses table** — já tem `ScrollArea` com `overflow-x-auto` ✅
- **Stats grid** — `grid-cols-2` funciona em 375px ✅
- **Dialogs** — `DialogContent` base já tem `max-w-[calc(100%-2rem)]` ✅
- **Admin page** — cards e layout ok ✅

### Validação
- `npx tsc --noEmit` ✅ (zero erros)

### Pendências
- Teste visual em 375px para users table com scroll horizontal
- Verificar QR code em 320px (iPhone SE)

---

## Handoff — Toin (Fix Responsividade ETAPA 5 Form Builder) — 2026-04-09 17:22 GMT-3

### O que foi feito
- Corrigidos 6 bugs de responsividade no Form Builder (mobile/iOS)
- Commit `992f58e`
- `npx tsc --noEmit` passou sem erros

### Bugs corrigidos

| Prioridade | Bug | Arquivo | Correção |
|---|---|---|---|
| P2 | h-screen não considera viewport dinâmico iOS Safari | `form-builder.tsx` | `h-screen supports-[height:100dvh]:h-[100dvh]` |
| P2 | Bottom nav sem safe-area padding (home indicator) | `form-builder.tsx` | `pb-[env(safe-area-inset-bottom)]` + `viewport-fit=cover` no `layout.tsx` |
| P2 | Botões duplicar/excluir inacessíveis em touch | `form-builder.tsx` | `opacity-100 md:opacity-0 md:group-hover:opacity-100` |
| P3 | Opinion Scale overflow no preview | `form-preview.tsx` | `flex flex-wrap` |
| P3 | Rating stars overflow no preview | `form-preview.tsx` | `flex flex-wrap` |
| P3 | Calendly iframe 520px fixo | `form-preview.tsx` | `h-[clamp(300px,60vh,520px)]` |

### Arquivos alterados
- `components/form-builder/form-builder.tsx` — 4 linhas alteradas
- `components/form-builder/form-preview.tsx` — 3 linhas alteradas
- `app/layout.tsx` — export `viewport` com `viewportFit: cover` adicionado

### Validação
- `npx tsc --noEmit` ✅ (zero erros)

### Pendências
- Teste visual em iPhone real (home indicator + notch)
- Verificar dvh fallback em Safari 15 (sem suporte a supports-[])

---

## Handoff — Toin (Fix Responsividade ETAPA 1 Form Player) — 2026-04-09 16:40 GMT-3

### O que foi feito
- Corrigidos 9 bugs de responsividade identificados pela Zefa no Form Player
- Todos os fixes em um único commit `a7c7e5d`
- `npx tsc --noEmit` passou sem erros

### Bugs corrigidos

| Prioridade | Bug | Arquivo | Correção |
|---|---|---|---|
| P0 | NPS overflow horizontal em mobile | `question-renderer.tsx` | `w-8 h-8 sm:w-12 sm:h-12` + `justify-center` + `gap-1 sm:gap-2` |
| P1 | Calendly widget altura fixa 630px | `question-renderer.tsx` | `height: 'clamp(400px, 60vh, 630px)'` |
| P1 | Dropdown país overflow lateral | `question-renderer.tsx` | `right-0 sm:right-auto sm:left-0` + `max-w-[calc(100vw-2rem)]` |
| P1 | CEP w-40 frágil em mobile | `question-renderer.tsx` | `w-36 sm:w-40` |
| P2 | Número/Complemento sem empilhamento | `question-renderer.tsx` | `flex flex-col sm:flex-row` |
| P2 | Cidade/Estado sem empilhamento | `question-renderer.tsx` | `flex flex-col sm:flex-row` |
| P2 | Footer sem background | `form-player.tsx` | `bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm` |
| P3 | Progress label sem safe area | `form-player.tsx` | `top-[env(safe-area-inset-top,12px)]` |
| P3 | Opinion Scale assimétrico | `question-renderer.tsx` | `justify-center` + `w-9 h-9 sm:w-12 sm:h-12` |

### Arquivos alterados
- `components/form-player/question-renderer.tsx` — 9 linhas alteradas
- `components/form-player/form-player.tsx` — 2 linhas alteradas

### Validação
- `npx tsc --noEmit` ✅ (zero erros)

### Pendências
- Teste visual em dispositivos reais (iPhone notch, Android small screens)
- Verificar Calendly widget em viewports entre 400-630px
- Dark mode do footer precisa validação visual

---

## Handoff — Toin (Fix Responsividade ETAPA 2 Landing Page) — 2026-04-09 16:45 GMT-3

### O que foi feito
- Corrigidos 8 bugs de responsividade na Landing Page
- Todos os fixes em um único commit `0aaaed9`
- `npx tsc --noEmit` passou sem erros

### Bugs corrigidos

| Prioridade | Bug | Arquivo | Correção |
|---|---|---|---|
| P1 | Footer logo transborda em 640-767px | `app/page.tsx` | `grid sm:grid-cols-2 lg:grid-cols-4` |
| P1 | Footer logo apertada em <375px | `app/page.tsx` | `max-w-full` no container da logo |
| P2 | Salto hero title 28→60px | `app/page.tsx` | `text-[28px] sm:text-4xl md:text-6xl lg:text-7xl` |
| P2 | "Como funciona" salta 1→3 colunas | `app/page.tsx` | `grid sm:grid-cols-2 md:grid-cols-3` |
| P2 | Hero glow 600px fixo em mobile | `app/page.tsx` | `w-[300px] sm:w-[600px]` |
| P3 | CSS redundante hero text | `app/page.tsx` | Simplificado para `text-sm text-slate-400` |
| P3 | Mobile menu sem animação | `components/mobile-menu.tsx` | Slide/fade com `transition-all duration-200` |
| P3 | Pricing badge apertado <360px | `components/pricing-section.tsx` | Padding/texto adaptativos `text-xs sm:text-sm` |

### Arquivos alterados
- `app/page.tsx` — 10 linhas alteradas
- `components/mobile-menu.tsx` — 5 linhas alteradas
- `components/pricing-section.tsx` — 4 linhas alteradas

### Validação
- `npx tsc --noEmit` ✅ (zero erros)

### Pendências
- Teste visual em iPhone SE (320px) para footer logo
- Verificar animação do mobile menu em Safari (pode precisar `-webkit-` prefix)
- Validar pricing toggle em viewports 320-360px

---

## Handoff — Toin (Fix Responsividade ETAPA 3 Auth) — 2026-04-09 17:05 GMT-3

### O que foi feito
- Padronizadas todas as 5 telas de autenticação para consistência visual
- Todos os fixes em um único commit `849a780`
- `npx tsc --noEmit` passou sem erros

### Telas afetadas
- `app/(auth)/login/page.tsx`
- `app/(auth)/register/page.tsx`
- `app/(auth)/forgot-password/page.tsx`
- `app/(auth)/reset-password/page.tsx`
- `app/(auth)/verify-email/page.tsx`

### Correções aplicadas

| Item | Antes | Depois | Telas |
|---|---|---|---|
| Logo height | 48 (login), 144 (verify) | 72 unificado | login, verify |
| Botão Voltar | `py-2 px-3` ou sem min-dim | `min-h-[44px] min-w-[44px]` | todas |
| Botão Voltar posição | `top-4 left-4` (login) | `top-6 left-6` | login |
| Padding topo | `pt-8` (login) | `pt-12` | login |
| Bordas inputs | `border-white/10` | `border-slate-500` | forgot, reset |
| Placeholder | `text-slate-500` | `text-slate-400` | forgot, reset |
| Card padding | `p-8` fixo | `p-6 sm:p-8` | todas |
| Toggle senha | sem dim fixa | `w-11 h-11 flex items-center justify-center` | reset |
| Container bottom | `pb-8` (register) | `pb-12` | register |
| Container bottom | sem pb | `pb-8` | verify |
| Link duplicado | "Voltar para login" dentro do card | removido | forgot |

### Validação
- `npx tsc --noEmit` ✅ (zero erros)

### Pendências
- Teste visual em dispositivos reais (foco em telas curtas com register)
- Verificar toggle de senha no reset em touch targets pequenos

---

## Handoff — Toin (Fix Responsividade ETAPA 4 Dashboard) — 2026-04-09 17:13 GMT-3

### O que foi feito
- Corrigidos bugs de responsividade no Dashboard (layout, cards, nav, modais)
- Todos os fixes em um único commit `64a3cb0`
- `npx tsc --noEmit` passou sem erros

### Componentes afetados
- `app/(dashboard)/dashboard/page.tsx`
- `components/dashboard/dashboard-shell.tsx`
- `components/dashboard/nav.tsx`
- `components/dashboard/form-card.tsx`
- `components/dashboard/templates-gallery.tsx`
- `components/onboarding/onboarding-modal.tsx`

### Correções aplicadas

| Item | Antes | Depois | Arquivo |
|---|---|---|---|
| Nav padding | `px-6` fixo | `px-4 sm:px-6` | `page.tsx` | |
| Mobile menu items | sem touch target | `min-h-[44px] rounded-lg py-3` | `nav.tsx` |
| Mobile menu overflow | sem scroll | `overflow-y-auto max-h-[calc(100vh-4rem)]` | `nav.tsx` |
| Sidebar em mobile | sempre visível | `lg:block hidden`, select inline substitui | `dashboard-shell.tsx` |
| Grid cards | `md:grid-cols-2` | `sm:grid-cols-2` | `dashboard-shell.tsx` |
| Header bar | sem wrap | `flex-wrap gap-3` | `dashboard-shell.tsx` |
| Filtro mobile | inexistente | Select inline + botão Nova pasta | `dashboard-shell.tsx` |
| Badge pasta | overflow de texto | `max-w-[140px] truncate` | `form-card.tsx` |
| Botões desktop | `size-sm` (~36px) | `h-11` (44px touch target) | `form-card.tsx` |
| Label respostas | "X respostas" | "X resp." em mobile | `form-card.tsx` |
| Template row | 5 itens inline | `flex-col sm:flex-row` responsivo | `templates-gallery.tsx` |
| Template actions | inline overflow | wrapper flex com gap | `templates-gallery.tsx` |
| Onboarding padding | `px-8` fixo | `px-6 sm:px-8` | `onboarding-modal.tsx` |
| Dialog mobile | sem margem | `mx-4` no DialogContent | `onboarding-modal.tsx` |

### Validação
- `npx tsc --noEmit` ✅ (zero erros)

### Pendências
- Teste visual em 375px (iPhone SE) para sidebar select
- Verificar Templates Gallery dialog em viewports 320-375px
- Validar onboarding modal em telas curtas (<600px altura)
- Confirmar que select de pastas mobile funciona bem com muitas pastas

## ETAPA A — Meta Events storage (2026-04-09)
- Demanda: adicionar captura/armazenamento de meta_events no backend de responses.
- O que foi feito:
  - Migration criada:  adicionando .
  - Endpoint  atualizado para aceitar  (array de strings), persistir em insert/update e retornar no GET de responses.
  - Tipos em  atualizados ( de ).
- Resultado/estado atual: ETAPA A concluída e compilando ().
- Arquivos alterados:
  - supabase/migrations/20260409_add_meta_events_to_responses.sql
  - app/api/responses/route.ts
  - lib/database.types.ts
- Pendências: aplicar migration no ambiente (db push/deploy) antes das próximas etapas consumirem a coluna.
- Próximo passo: ETAPA B (usar  em template WhatsApp/exports/sync).

## 2026-04-09 — ETAPA B (WhatsApp meta_events)
- Incluído `meta_events` no `leadData` em `lib/integration-stubs.ts`, formatado como string com `join('; ')`.
- Atualizado builder em `app/api/whatsapp/send/route.ts` para substituir `{meta_events}`.
- Ajustado fluxo em `app/api/responses/route.ts` para selecionar e propagar `meta_events` da response (`select('id, meta_events')`) para o envio WhatsApp.
- Validação: `npx tsc --noEmit` executado com sucesso.

## 2026-04-09 — ETAPA C (Zeca)
- Backend exportação atualizado para incluir `meta_events`.
- CSV (`/api/forms/[id]/export-csv` e `/api/forms/[id]/export?format=csv`) agora:
  - seleciona `meta_events` no select de responses
  - inclui coluna `meta_events` no header
  - serializa valor com `join('; ')`
- Google Sheets (`lib/google-sheets.ts`) agora:
  - adiciona coluna fixa `meta_events` no header inicial
  - preserva `meta_events` ao reconstruir header dinâmico
  - escreve valor formatado com `join('; ')` a partir de `answers.meta_events`
- Validação: `npx tsc --noEmit` executado sem erros.
- Commit: `feat(export): add meta_events to CSV and Google Sheets sync` (`edc3df8`).

## ETAPA E — Frontend: UI para meta_events (Toin)
- WhatsApp Panel (`components/form-builder/whatsapp-panel.tsx`): adicionada variável `{meta_events}` em “Variáveis disponíveis” com descrição dos eventos Meta Pixel.
- Responses Dashboard (`components/responses/responses-dashboard.tsx`):
  - adicionada coluna `Eventos` na tabela de respostas;
  - renderização de `meta_events` com `join("; ")`;
  - no dialog de detalhe, adicionada seção `Meta Events` com badges quando existir.
- Ajuste de formatação de arrays na UI para separador `; `, mantendo consistência com a nova coluna.
- Validação: `npx tsc --noEmit` sem erros.

## 2026-04-09 — Fix WhatsApp Panel auto-save no mount (Zeca)
- Demanda: corrigir erro "Erro ao salvar: Failed to save settings" ao abrir aba Integrações.
- O que foi feito:
  - Adicionada função `normalizeSettingsSnapshot` para serializar o estado relevante de auto-save.
  - Criado estado `initialSnapshot` para guardar snapshot carregado da API no primeiro load.
  - No load inicial, snapshot agora é definido tanto quando há settings salvas quanto no fallback sem settings.
  - `useEffect` de auto-save passou a bloquear quando `settingsInitialized`/`initialSnapshot` ainda não estão prontos.
  - Incluída guarda para não salvar quando estado atual ainda é igual ao snapshot inicial (evita save no mount).
- Resultado/estado atual: auto-save só dispara após mudanças reais do usuário, evitando POST indevido com defaults ao abrir a aba.
- Arquivos alterados:
  - `components/form-builder/whatsapp-panel.tsx`
- Validação:
  - `npx tsc --noEmit` ✅
- Commit:
  - `1004880` — `fix(whatsapp): prevent autosave before settings initialization`
- Pendências:
  - Teste manual no navegador para confirmar ausência de erro toast ao abrir Integrações.
- Próximo passo:
  - Validar fluxo completo (abrir aba, editar campo, aguardar debounce, confirmar save normal).
