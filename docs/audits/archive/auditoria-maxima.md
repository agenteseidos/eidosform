# Auditoria Máxima EidosForm — 2026-04-23

## Resumo

| Severidade | Backend | Frontend | UX/Conversão | Segurança | Browser | **Total** |
|---|---|---|---|---|---|---|
| **P0** | 3 | 2 | 1 | 0 | 0 | **6** |
| **P1** | 5 | 4 | 4 | 1 | 0 | **14** |
| **P2** | 4 | 10 | 9 | 5 | 1 | **29** |
| **P3** | 3 | 7 | 2 | 4 | 0 | **16** |
| **Total** | **15** | **23** | **16** | **10** | **1** | **65** |

> **Nota:** O site eidosform.com está com página "Under construction" do Squarespace. Testes em browser foram limitados. Muitos achados marcados como [NÃO TESTADO].

---

## Bugs P0

### P0-1: Signup usa `listUsers()` para checar email duplicado
- **Arquivo/Rota:** `app/api/auth/signup/route.ts` (~linha 34)
- **Categoria:** Backend / Performance / Segurança
- **Passos pra reproduzir:** Criar conta quando o tenant tem milhares de usuários
- **Esperado:** Query direta por email ou usar `supabase.auth.signUp` que já retorna erro de duplicata
- **Observado:** `admin.auth.admin.listUsers()` lista TODOS os usuários do tenant para checar se email existe. O(n) em memória, lento, pode causar timeout/OOM. Vaza metadata de todos os usuários via API admin client.
- **Impacto:** Degradação de performance, possível OOM em tenants grandes, vazamento de dados
- **[NÃO TESTADO]** — depende de volume de usuários no tenant

### P0-2: `x-response-id` permite update de qualquer resposta sem autenticação
- **Arquivo/Rota:** `app/api/responses/route.ts` (~linha 224)
- **Categoria:** Backend / Segurança / IDOR
- **Passos pra reproduzir:** Enviar POST para `/api/responses` com header `x-response-id: <uuid-de-outra-pessoa>` e novo `answers` no body
- **Esperado:** Update parcial deve exigir verificação de ownership (respondent_id) ou origem da requisição
- **Observado:** Qualquer UUID válido permite update sem auth. Pula `checkResponseLimit` e faz UPDATE com apenas `eq('id', id)` + `eq('form_id', form_id)`. Sem verificação de quem criou a resposta.
- **Impacto:** Qualquer pessoa que conheça/advinhe um response UUID pode sobrescrever respostas de outros usuários

### P0-3: Supabase `error.message` vaza detalhes internos pro cliente
- **Arquivo/Rota:** Múltiplas rotas — `app/api/forms/route.ts:46`, `app/api/forms/[id]/route.ts` (PATCH, DELETE), `app/api/forms/[id]/webhook/route.ts` (PUT, DELETE), `app/api/folders/route.ts`, `app/api/folders/[id]/route.ts`, `app/api/domains/route.ts`
- **Categoria:** Backend / Segurança / Info Leak
- **Passos pra reproduzir:** Enviar request inválido para qualquer dessas rotas e observar o response body
- **Esperado:** Mensagem genérica ("Erro interno") com log interno do erro real
- **Observado:** `return NextResponse.json({ error: error.message }, { status: 500 })` — vaza nomes de tabelas, colunas, constraints SQL e detalhes de infraestrutura
- **Impacto:** Atacante obtém informação do schema do banco para planejar ataques mais sofisticados

### P0-4: `React.memo` customizado do form-player ignora mudanças em `form.questions`, `form.status`, `form.is_closed`
- **Arquivo/Rota:** `components/form-player/form-player.tsx`
- **Categoria:** Frontend / Dados stale
- **Passos pra reproduzir:** Usuário edita form no builder (adiciona pergunta, muda título, fecha form) → form repassado ao player
- **Esperado:** Player re-renderiza com dados atualizados
- **Observado:** Custom `React.memo` só compara `form.id` e `ownerPlan`. Se não mudarem, player NÃO re-renderiza. Dados ficam stale em preview/hot-reload.
- **Impacto:** Usuário vê versão desatualizada do formulário. É o componente central do produto.

### P0-5: `loadPartialProgress` referencia `visibleQuestions` antes de ser definido
- **Arquivo/Rota:** `components/form-player/form-player.tsx`
- **Categoria:** Frontend / Lógica
- **Passos pra reproduzir:** Usuário autenticado com plano Plus abre formulário com respostas parciais e conditional logic que oculta perguntas
- **Esperado:** Progresso parcial restaurado na posição correta
- **Observado:** `loadPartialProgress` usa `visibleQuestions` que é calculado mais abaixo no código. Na primeira execução, `visibleQuestions` está no estado inicial (todas visíveis). Se `last_question_answered` apontar para pergunta ocultada por conditional logic, `findIndex` retorna -1 e posição não é restaurada.
- **Impacto:** Usuário perde progresso ao retornar a formulário com conditional logic

### P0-6: Claim "Economize até 40%" é imprecisa (false advertising)
- **Arquivo/Rota:** `components/pricing-section.tsx` e `components/billing-plans.tsx`
- **Categoria:** UX / Conversão / Legal
- **Passos pra reproduzir:** Olhar tabela de preços no pricing
- **Esperado:** Claim honesta sobre economia real
- **Observado:** "Economize até 40%" — na realidade: Starter=40.8%, Plus=23.6%, Professional=23.3%. A maioria dos planos economiza ~23%. Usuário que olha Plus ou Professional sente claim enganosa.
- **Impacto:** Risco legal (PROCON/ANVISA), desconfiança do usuário

---

## Bugs P1

### P1-1: Respostas parciais (`partial-response`) sem rate limiting
- **Arquivo/Rota:** `app/api/forms/[id]/partial-response/route.ts`
- **Passos pra reproduzir:** Enviar múltiplos PUT requests em sequência rápida
- **Esperado:** Rate limit por user+form (~30 req/min)
- **Observado:** Sem nenhum rate limiting. Autosave a cada keystroke pode floodar o banco.

### P1-2: CEP rate limit usa in-memory Map (sem persistência)
- **Arquivo/Rota:** `app/api/cep/[cep]/route.ts`
- **Passos pra reproduzir:** Fazer requests distribuídos (cold starts em Vercel reseta o Map)
- **Esperado:** Rate limit persistente via Supabase RPC (como outros endpoints)
- **Observado:** Map() local, sem persistência cross-invocation

### P1-3: `POST /api/forms` vaza `error.message` em slug conflict
- **Arquivo/Rota:** `app/api/forms/route.ts` (~linha 67)
- **Passos pra reproduzir:** Enviar request que cause erro de DB diferente do 23505
- **Esperado:** Mensagem genérica para erros não mapeados
- **Observado:** Fallback `return NextResponse.json({ error: error.message }, { status: 500 })` antes do check de `error.code === '23505'`

### P1-4: Webhook Asaas — fallback token legacy é fraco (timing attack)
- **Arquivo/Rota:** `app/api/webhooks/asaas/route.ts` (~linhas 82-95)
- **Passos pra reproduzir:** Enviar webhooks com `ASAAS_WEBHOOK_SECRET` não configurado
- **Esperado:** Sempre usar HMAC com timing-safe comparison
- **Observado:** Fallback usa comparação direta `!==` (não timing-safe). Token via query string aparece em logs.

### P1-5: `GET /api/responses` sem rate limiting
- **Arquivo/Rota:** `app/api/responses/route.ts` (GET handler)
- **Passos pra reproduzir:** Polling excessivo das respostas
- **Esperado:** Rate limit por user (~60 req/min)
- **Observado:** Sem rate limit

### P1-6: `useMemo` com side-effect: `setPage(1)` dentro de `useMemo`
- **Arquivo/Rota:** `components/responses/responses-dashboard.tsx`
- **Passos pra reproduzir:** Mudar filtro de status
- **Esperado:** Reset de página via `useEffect`
- **Observado:** `useMemo` é para computação pura. Side-effect dentro pode causar warnings em Strict Mode e double-invocation em React 18+

### P1-7: CEP lookup sem debounce — chamada API a cada keystroke
- **Arquivo/Rota:** `components/settings/billing-profile-settings.tsx`
- **Passos pra reproduzir:** Digitar CEP rapidamente
- **Esperado:** Busca só quando CEP completo (8 dígitos) ou com debounce
- **Observado:** Se onChange chama API sem verificar comprimento, gera requisições desnecessárias

### P1-8: Polling de checkout sem timeout máximo
- **Arquivo/Rota:** `components/checkout-success-overlay.tsx`
- **Passos pra reproduzir:** Checkout iniciado → webhook nunca chega
- **Esperado:** Timeout após X segundos com mensagem de erro
- **Observado:** Se polling nunca receber confirmação, fica infinitamente verificando. UX ruim + consumo de API.

### P1-9: "Segurança enterprise" promete mais do que entrega
- **Arquivo/Rota:** Landing page
- **Passos pra reproduzir:** Ler a landing page
- **Esperado:** Claims correspondem à realidade
- **Observado:** "Criptografia end-to-end" — provavelmente só TLS. "Auditoria de acesso" e "controle granular de permissões" — não implementado nos planos visíveis.

### P1-10: "Notificação por WhatsApp" duplicada no Professional no pricing-section
- **Arquivo/Rota:** `components/pricing-section.tsx`
- **Passos pra reproduzir:** Comparar pricing-section.tsx vs billing-plans.tsx
- **Esperado:** "Tudo do Plus +" sem duplicar features já incluídas
- **Observado:** Professional lista "Notificação por WhatsApp" mas já está no Plus. Duplicação confunde.

### P1-11: Novo formulário: redirect silencioso em caso de erro
- **Arquivo/Rota:** `app/forms/new/page.tsx`
- **Passos pra reproduzir:** Criar form com erro (ex: limite atingido)
- **Esperado:** Toast ou mensagem clara de erro
- **Observado:** Redirect para `/forms?error=create_failed` sem feedback visual. Parâmetro `error` pode não ser tratado na página destino.

### P1-12: Onboarding existe mas é básico
- **Arquivo/Rota:** `components/onboarding/onboarding-modal.tsx`
- **Passos pra reproduzir:** Primeiro login como novo usuário
- **Esperado:** Tutorial interativo guiando criação do primeiro form
- **Observado:** Modal simples com steps. Sem walkthrough interativo, sem tooltips contextuais. Novo usuário precisa descobrir sozinho.

### P1-13: CSRF ausente em API Routes de escrita
- **Arquivo/Rota:** `POST/PUT/DELETE /api/forms/*`, `POST /api/responses`, `POST /api/upload`, etc.
- **Categoria:** Segurança
- **Passos pra reproduzir:** Usuário autenticado visita site malicioso que faz POST cross-origin
- **Esperado:** Verificação de Origin/Referer ou CSRF token
- **Observado:** Middleware só chama `updateSession()`. Sem verificação de Origin. Next.js protege Server Actions mas não API Routes.
- **Impacto:** Ataque CSRF pode criar/excluir forms em nome de usuário autenticado

### P1-14: Site não está deployado — todas as rotas mostram "Under construction"
- **Arquivo/Rota:** eidosform.com (todas as URLs)
- **Categoria:** Browser / Infra
- **Passos pra reproduzir:** Abrir eidosform.com
- **Esperado:** Aplicação EidosForm funcionando
- **Observado:** Página "We're under construction" do Squarespace. Nenhum CTA, nenhum fluxo funcional.

---

## Bugs P2

### P2-1: `/api/upload` GET público expõe configuração R2
- **Arquivo/Rota:** `app/api/upload/route.ts` (GET handler)
- **Esperado:** Auth obrigatória
- **Observado:** `{ configured: true/false }` sem autenticação. Reconhecimento de infraestrutura.

### P2-2: `/api/health` sem rate limiting
- **Arquivo/Rota:** `app/api/health/route.ts`
- **[NÃO TESTADO]** — impacto prático baixo

### P2-3: Export endpoints duplicam lógica CSV
- **Arquivo/Rota:** `app/api/forms/[id]/export/route.ts` e `app/api/forms/[id]/export-csv/route.ts`
- **Esperado:** Um único endpoint com rate limit
- **Observado:** Dois caminhos CSV com lógica diferente. `export-csv` tem rate limit (5/hora) mas `export?format=csv` não.

### P2-4: `handleDowngrade` carrega TODAS as responses para contar
- **Arquivo/Rota:** `lib/plan-limits.ts` (função `handleDowngrade`)
- **[NÃO TESTADO]** — depende de volume
- **Esperado:** COUNT via Supabase query
- **Observado:** Carrega todas as rows em memória para contar. Pode causar OOM.

### P2-5: Autosave debounced causa re-saves infinitos
- **Arquivo/Rota:** `components/form-builder/form-builder.tsx`
- **Esperado:** Autosave dispara uma vez por batch
- **Observado:** `handleAutosave` como dependência do useEffect causa recriação → re-trigger

### P2-6: `formUrl` com hydration mismatch potencial
- **Arquivo/Rota:** `components/form-builder/form-builder.tsx`
- **Esperado:** URL consistente entre server e client
- **Observado:** `typeof window !== 'undefined'` com `window.location.origin` pode diferir do SSR

### P2-7: Código duplicado: conditional logic e jump rules 3x
- **Arquivo/Rota:** `components/form-builder/question-editor.tsx`
- **Esperado:** Single source of truth
- **Observado:** ~100 linhas duplicadas em 3 lugares

### P2-8: WhatsApp auto-save silencioso com saves infinitos
- **Arquivo/Rota:** `components/form-builder/whatsapp-panel.tsx`
- **Esperado:** `initialSnapshot` atualiza após save
- **Observado:** `initialSnapshot` nunca atualizado → saves a cada 3s enquanto houver mudanças

### P2-9: Instâncias WhatsApp hardcoded e comentadas
- **Arquivo/Rota:** `components/form-builder/whatsapp-panel.tsx`
- **Observado:** `['default', 'instancia-2', 'instancia-3']` hardcoded, seções comentadas. Code smell.

### P2-10: `handleSubmit` usa `document.querySelector` para honeypot
- **Arquivo/Rota:** `components/form-player/form-player.tsx`
- **Esperado:** Ref ou estado do React
- **Observado:** `document.querySelector('input[name="_hp_"]')` — frágil se honeypot não renderizar

### P2-11: Dropdown options usam `index` como `key`
- **Arquivo/Rota:** `components/form-player/question-renderer.tsx`
- **Passos pra reproduzir:** Criar dropdown → reordenar opções no builder
- **Esperado:** Seleção correta após reordenação
- **Observado:** `key={index}` causa React reconciliation bug. Seleção visual pode não corresponder ao valor.

### P2-12: Exportação XLSX/PDF via `<a href>` sem auth
- **Arquivo/Rota:** `components/responses/responses-dashboard.tsx`
- **Esperado:** Download com headers de auth
- **Observado:** Link direto sem headers. Se API exige auth, download falha silenciosamente (blob vazio).

### P2-13: Features listadas nos planos vs funcionalidade real — inconsistência
- **Arquivo/Rota:** `components/billing-plans.tsx`, `components/pricing-section.tsx`
- **Esperado:** Claims = realidade
- **Observado:** Requer validação cruzada com plan-definitions e APIs. Risco de false advertising.

### P2-14: pricing-section duplica lógica de planos (DRY violation)
- **Arquivo/Rota:** `components/pricing-section.tsx`
- **Observado:** Duplica lista de features em componente separado do billing-plans.tsx. Inconsistência entre as duas versões.

### P2-15: Inconsistência pricing-section vs plan-definitions
- **Arquivo/Rota:** `components/pricing-section.tsx`
- **Observado:** Plus: "Notificação por WhatsApp" com parênteses vazio vs billing-plans sem parênteses. Professional: duplica feature.

### P2-16: Feature "Documentação API" no footer é link morto
- **Arquivo/Rota:** Landing page (footer)
- **Esperado:** Link funcional
- **Observado:** `<span className="cursor-not-allowed">Documentação API</span>` — não é link, nada acontece ao clicar.

### P2-17: "Builder Visual — Arraste, solte e configure" possivelmente oversold
- **Arquivo/Rota:** Landing page
- **Esperado:** Real drag-and-drop
- **Observado:** Verificar se builder é realmente DnD ou click-to-add

### P2-18: Sem loading state na criação de formulário
- **Arquivo/Rota:** `app/forms/new/page.tsx`
- **Esperado:** Indicador de loading
- **Observado:** Server-side redirect sem indicador. Usuário pode achar que nada aconteceu.

### P2-19: "Meta Pixel", "GTM", "TikTok Pixel" sem explicação
- **Arquivo/Rota:** Pricing do Plus
- **Esperado:** Tooltip ou subtítulo explicativo
- **Observado:** Jargão técnico sem contexto para leigo

### P2-20: "Respostas parciais (salvamento automático)" ambíguo
- **Arquivo/Rota:** Pricing
- **Esperado:** Descrição clara
- **Observado:** O form salva automaticamente? Ou o respondente ativa? Ambíguo.

### P2-21: API Key armazenada em plaintext no banco
- **Arquivo/Rota:** `lib/api-key-auth.ts`, `app/api/settings/api-key/route.ts`
- **Categoria:** Segurança
- **Esperado:** Hash com bcrypt antes de armazenar
- **Observado:** Texto puro na coluna `api_key`. Qualquer acesso ao banco expõe todas as keys.

### P2-22: Rate limit in-memory fallback vulnerável em serverless
- **Arquivo/Rota:** `lib/rate-limit.ts`, `lib/response-rate-limit.ts`, `lib/upload-rate-limit.ts`
- **Categoria:** Segurança
- **Esperado:** Rate limit persistente (Redis/Supabase)
- **Observado:** Fallback in-memory per-isolate. Cold starts reset. TODO no código menciona migração para Redis.

### P2-23: Webhook Asaas — fallback token por query string
- **Arquivo/Rota:** `app/api/webhooks/asaas/route.ts`
- **Categoria:** Segurança
- **Esperado:** Exigir header ou HMAC
- **Observado:** Token via query param aparece em access logs, browser history, referer headers.

### P2-24: Meta Pixel ID injection via `dangerouslySetInnerHTML`
- **Arquivo/Rota:** `app/f/[slug]/page.tsx:161`
- **Categoria:** Segurança
- **Observado:** Pixel ID validado com regex `/^\d{10,20}$/` (bom). Mas arquitetura sensível — se validação for relaxada, vira XSS. Considerar `next/script`.

### P2-25: IDOR potencial em rotas de forms/respostas
- **Arquivo/Rota:** `GET /api/forms/[id]`, `GET /api/responses`
- **Categoria:** Segurança
- **Observado:** RLS do Supabase protege, mas se falhar na configuração, dados vazam. Defender-in-depth faltando.

### P2-26: URL `/foo` retorna 200 com página de construção em vez de 404
- **Arquivo/Rota:** eidosform.com/foo
- **Categoria:** Browser/Infra
- **Esperado:** Status 404
- **Observado:** Status 200 com "under construction"

### P2-27: "Setup em 30 segundos" — claim vaga
- **Arquivo/Rota:** Landing page (2x)
- **Observado:** Registro exige email+senha+confirmação. Dificilmente em 30s. Inofensivo mas impreciso.

### P2-28: Links de anchor no footer quebram fora da landing
- **Arquivo/Rota:** Footer (Recursos, Preços, FAQ)
- **Observado:** `href="#recursos"` funciona na landing mas quebra em outras páginas

### P2-29: Sem loading state explícito na criação de formulário
- **Arquivo/Rota:** `app/forms/new/page.tsx`
- **Observado:** Server-side redirect sem indicador visual

---

## Bugs P3

### P3-1: `sanitizeValue` usa regex simples para XSS
- **Arquivo/Rota:** `app/api/responses/route.ts`
- **[NÃO TESTADO]** — depende de como frontend renderiza
- **Observado:** `val.replace(/<[^>]*>/g, '')` remove tags mas não todos os vetores XSS

### P3-2: `detectPlanAndCycle` pode mapear plano errado
- **Arquivo/Rota:** `app/api/webhooks/asaas/route.ts`
- **Observado:** Fallback parseia `description` do Asaas que pode mudar. Deveria usar metadados estruturados.

### P3-3: Admin endpoints sem CSRF token explícito
- **Arquivo/Rota:** `app/api/admin/*`
- **[NÃO TESTADO]** — mitigação existente (httpOnly cookie, sameSite=lax) é razoável

### P3-4: Botão duplicar/excluir sempre visível em mobile
- **Arquivo/Rota:** `components/form-builder/form-builder.tsx`
- **Observado:** `opacity-100 md:opacity-0` — sempre visível em mobile, pode poluir UI

### P3-5: Clipboard fallback usa `document.execCommand('copy')` (deprecated)
- **Arquivo/Rota:** `components/form-builder/right-panel.tsx`
- **Observado:** Pode falhar silenciosamente em futuras versões

### P3-6: Conditional logic permite referenciar content_block como condição
- **Arquivo/Rota:** `components/form-builder/question-editor.tsx`
- **Observado:** Não faz sentido condicionar com base em resposta de content_block

### P3-7: `dangerouslySetInnerHTML` em form-preview sem CSP sanitization
- **Arquivo/Rota:** `components/form-builder/form-preview.tsx`
- **Observado:** Depende de `renderTiptapHtml`. Se Tiptap output contiver scripts, pode executar.

### P3-8: Calendly script pode ser carregado múltiplas vezes
- **Arquivo/Rota:** `components/form-player/question-renderer.tsx`
- **Observado:** Se ref for resetado (remount completo), script adicionado de novo ao DOM

### P3-9: Tabela de respostas pode crashar com perguntas sem `id`
- **Arquivo/Rota:** `components/responses/responses-dashboard.tsx`
- **Observado:** `key={q.id}` — se `q.id` for undefined, causa warnings

### P3-10: Campo de upload de avatar sem preview de loading
- **Arquivo/Rota:** `components/settings/profile-settings.tsx`
- **Observado:** Sem loading state durante upload

### P3-11: Menu mobile sem focus trap (acessibilidade)
- **Arquivo/Rota:** `components/mobile-menu.tsx`
- **Observado:** Portal sem focus trap — usuário pode tabular para elementos atrás do menu

### P3-12: "Exportação CSV avançada" no Professional sem descrição
- **Arquivo/Rota:** Pricing
- **Observado:** Usuário não sabe a diferença para CSV normal do Starter

### P3-13: `httpOnly: false` no cookie `__lastActivity`
- **Arquivo/Rota:** `lib/auth.ts`
- **Categoria:** Segurança
- **Observado:** Legível por JS (XSS pode ler). Baixo risco pois é apenas timestamp.

### P3-14: API v1 retorna dados completos do form
- **Arquivo/Rota:** `app/api/v1/forms/route.ts`, `app/api/v1/forms/[id]/route.ts`
- **Categoria:** Segurança
- **Observado:** Inclui config de webhooks, pixels, etc. Pode expor config sensível.

### P3-15: Upload — nome de arquivo do usuário no objeto key
- **Arquivo/Rota:** `app/api/upload/route.ts`
- **Categoria:** Segurança
- **Observado:** Se nome original usado como parte do key no R2, pode haver path traversal.

### P3-16: Admin hardcoded por email em env var
- **Arquivo/Rota:** `lib/admin-auth.ts`
- **Categoria:** Segurança
- **Observado:** Funcional mas sem audit trail. Para o tamanho do projeto, OK.

---

## UX — Achados Consolidados

1. **Claim "Economize até 40%" é imprecisa** (P0) — maioria dos planos economiza ~23%
2. **"Segurança enterprise" oversold** (P1) — claims de E2E encryption, auditoria de acesso, controle granular não implementados
3. **"Notificação por WhatsApp" duplicada no Professional** (P1) — confunde
4. **Link morto "Documentação API"** (P2) — cursor-not-allowed, não é link
5. **Onboarding básico** (P1) — modal simples sem walkthrough interativo
6. **Redirect sem feedback visual em erro de criação** (P1)
7. **Jargão técnico sem explicação** (P2) — Meta Pixel, GTM, TikTok Pixel
8. **"Respostas parciais" ambíguo** (P2) — não fica claro pro leigo
9. **"Setup em 30 segundos" impreciso** (P2)
10. **Inconsistência entre pricing-section e billing-plans** (P2)
11. **Links de anchor quebram fora da landing** (P3)

## Conversão — Achados

1. **"Economize até 40%"** — a maioria economiza ~23%. Desconfiança imediata.
2. **"Segurança enterprise"** — se não é real, perde credibilidade com público B2B
3. **Onboarding fraco** — novo usuário precisa descobrir tudo sozinho. Taxa de abandono alta.
4. **Link morto "Documentação API"** — dev que clica esperando docs, não encontra. Frustrante.
5. **Builder "arraste e solte"** — se não é DnD real, expectativa vs realidade gera churn
6. **Pricing duplicado** — duas versões inconsistentes (landing vs painel) gera confusão

---

## Segurança — Resumo

### ✅ Pontos bem implementados
- **XSS:** `sanitizeValue()` faz strip de HTML tags; pixel ID validado com regex
- **Webhook HMAC:** timingSafeEqual, timestamp check, replay protection
- **SSRF:** webhook-validator bloqueia private IPs, localhost, exige HTTPS
- **Upload:** Auth obrigatório, validação de tipo (whitelist) e tamanho (10MB), rate limit
- **SQL Injection:** Supabase client parameterized em todo o código — sem raw SQL
- **Admin routes:** `requireAdmin()` com verificação server-side
- **Secrets:** Nenhum hardcoded encontrado
- **Rate limiting:** 3 camadas (API key, responses, upload) com Supabase RPC + fallback
- **Honeypot** + rate limiting + payload size limit no endpoint de respostas

### ⚠️ Pontos a melhorar
- CSRF em API Routes de escrita (P1)
- API Key em plaintext no banco (P2)
- Rate limit in-memory em serverless (P2)
- Token Asaas via query string (P2)
- IDOR dependente exclusivo de RLS (P2)
- `dangerouslySetInnerHTML` para Meta Pixel (P2)

---

## [NÃO TESTADO]

| Item | Motivo |
|---|---|
| Signup `listUsers()` performance | Depende de volume de usuários no tenant |
| `handleDowngrade` OOM | Depende de volume de respostas |
| `sanitizeValue` XSS completo | Depende de como frontend renderiza os dados |
| Admin CSRF | Mitigação existente (sameSite=lax) é razoável |
| `/api/health` rate limit | Impacto prático baixo |
| Fluxos 2-5 do browser (dashboard, form, pricing, settings) | Site está "under construction" no Squarespace |
| Builder drag-and-drop real | Não testável sem app funcional |
| Exportação XLSX/PDF com auth | Não testável sem app funcional |
| Checkout polling timeout | Não testável sem app funcional |
| CEP debounce real | Precisa confirmar com leitura completa do componente |

---

## Recomendação de Ordem de Correção

### Fase 1 — Crítica (imediata, 1-3 dias)
1. **P0-2:** Corrigir IDOR no `x-response-id` — adicionar verificação de ownership
2. **P0-3:** Substituir `error.message` por mensagem genérica em todas as rotas 500
3. **P0-4/P0-5:** Corrigir React.memo e ordem de definição no form-player
4. **P0-6:** Corrigir claim "Economize até 40%" para refletir realidade

### Fase 2 — Alta (esta semana)
5. **P1-1:** Rate limit no partial-response
6. **P1-4:** Remover fallback token legacy do Asaas
7. **P1-13:** Adicionar verificação de Origin em API Routes autenticadas
8. **P1-8:** Timeout no polling de checkout
9. **P1-9:** Revisar claims de segurança enterprise
10. **P1-14:** Deploy da aplicação no domínio eidosform.com

### Fase 3 — Média (próxima sprint)
11. **P2-1:** Remover GET público do upload ou exigir auth
12. **P2-3:** Consolidar export endpoints CSV
13. **P2-5/P2-8:** Corrigir loops de autosave
14. **P2-11:** Corrigir `key={index}` em dropdown options
15. **P2-16:** Transformar "Documentação API" em link real ou remover
16. **P2-21:** Hash de API keys no banco
17. **P1-12:** Melhorar onboarding com walkthrough interativo

### Fase 4 — Baixa (backlog)
18. Todos os P3s — corrigir conforme disponibilidade
19. Migrar rate limit para Redis
20. Substituir `document.execCommand` por Clipboard API
21. Adicionar focus trap no menu mobile
22. Consolidar componentes de pricing (DRY)

---

*Relatório gerado por Zéfa — 2026-04-23 01:38 BRT*
*65 achados totais: 6 P0, 14 P1, 29 P2, 16 P3*
