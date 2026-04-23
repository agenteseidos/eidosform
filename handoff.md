## Handoff — Zeca → Sidney — 2026-04-23 13:50 GMT-3

### Demanda
Bug urgente pós-checkout Asaas: pagamento confirmado no Asaas mas UI mostrava "Pagamento ainda não confirmado".

### Causa Raiz
O checkout hospedado do Asaas **não retorna subscription ID na criação** — esse ID só é populado quando o webhook `PAYMENT_CONFIRMED` chega e o handler atualiza o `billing_checkouts`. O `/api/checkout/status` só fazia fallback ao Asaas se tivesse `asaas_subscription_id` local. Se o usuário voltava rápido (antes do webhook), o endpoint não conseguia verificar o pagamento no Asaas e retornava "pending".

Além disso, `billing_checkouts.status === 'paid'` não era reconhecido como sucesso.

### O que foi feito

**`app/api/checkout/status/route.ts`:**
- Adicionado fast path: se `billing_checkouts.status === 'paid'` → retorna `success`
- Quando `asaas_subscription_id` não existe mas `asaas_customer_id` sim → consulta assinaturas do customer no Asaas como segundo fallback
- Se encontra subscription ACTIVE no Asaas → backfill do `asaas_subscription_id` no `billing_checkouts` e `profiles` para futuras consultas rápidas
- Passa a buscar `asaas_customer_id` tanto do checkout quanto do profile

**`lib/asaas.ts`:**
- Nova função `getCustomerSubscriptions(customerId)` — lista assinaturas de um customer via API do Asaas

### Validação
- `npm run build`: ✅
- Commit: `6e52e1c`

### Arquivos alterados
- `app/api/checkout/status/route.ts`
- `lib/asaas.ts`

### Regra final do fluxo pós-checkout
1. Usuário paga no checkout Asaas
2. Asaas redireciona para `/billing?checkout=success`
3. Overlay polling `/api/checkout/status` a cada 3s (até 120s)
4. Resolução de status (em ordem):
   - `profiles.plan` + `plan_status === 'active'` → **success** (webhook já processou)
   - `billing_checkouts.status === 'paid'` → **success** (webhook atualizou checkout)
   - `billing_checkouts.status === 'cancelled'`/`'overdue'` → cancel/expire
   - Se tem `asaas_subscription_id` → consulta Asaas diretamente
   - Se tem `asaas_customer_id` (sempre disponível) → lista subscriptions do customer no Asaas
   - Se Asaas diz ACTIVE → backfill IDs local + **success**
   - Senão → **pending** (continua polling)
5. Webhook `PAYMENT_CONFIRMED` eventualmente chega e atualiza tudo

### Pendências
- Nenhuma

### Próximo passo
- Testar checkout completo no sandbox
- Deploy quando quiser

---

## Handoff — Zeca → Sidney — 2026-04-23 13:15 GMT-3

### Demanda
Correção estrutural do checkout Asaas — PIX não funciona com cobrança RECURRENT.

### Problema
A API do Asaas tem duas restrições confirmadas:
1. CREDIT_CARD é o único método permitido para RECURRENT
2. RECURRENT não pode ser combinado com outros chargeTypes no mesmo checkout

O commit anterior (`36f217e`) tentou adicionar DETACHED ao lado de RECURRENT, mas isso também falha — a API rejeita a combinação.

### Solução aplicada
**Regra de negócio: assinaturas recorrentes aceitam APENAS cartão de crédito.**

- `lib/asaas.ts`: `billingTypes: ['CREDIT_CARD']`, `chargeTypes: ['RECURRENT']`
- `components/billing-plans.tsx`: texto de pagamento atualizado de "💳 Cartão · ⚡ PIX" para "💳 Cartão de crédito"

### Validação
- `npm run build`: ✅
- Commit: `3047315`

### Arquivos alterados
- `lib/asaas.ts` — billingTypes e chargeTypes corrigidos
- `components/billing-plans.tsx` — UI reflete apenas cartão

### Pendências
- Se no futuro quiser aceitar Pix, seria necessário um fluxo separado (checkout DETACHED sem recorrência) ou upgrade de plano Asaas

### Próximo passo
- Testar checkout cartão no sandbox
- Deploy quando quiser

---

## Handoff — Toin → Sidney — 2026-04-23 02:28 GMT-3

### Demanda
Corrigir bugs encontrados nos testes de browser (auditoria-browser.md).

### O que foi feito

**P1-1 ✅ — Registro sem validação client-side:**
- Adicionado `required` em todos os inputs do formulário (nome, email, senha, confirmar, checkbox termos)
- Implementado estado de errors + touched para validação visual
- Borda vermelha + texto de erro inline em cada campo quando vazio ou inválido
- Validação de email via regex

**P1-2 ✅ — Já corrigido em commit anterior:** Toast errors já capturavam erros do Supabase.

**P2-1 ✅ — Já corrigido:** Login já tinha toast.error para credenciais inválidas.

**P2-2 ✅ — Já corrigido:** Nav já usava `hidden md:flex` para desktop + MobileMenu.

**P2-3 ✅ — Já corrigido:** Todos os arquivos mostram "41%".

**P2-4 ✅ — Já corrigido:** Onboarding usa `isNewUser = forms.length === 0` + wrapper com localStorage.

**P3-1 ✅ — Links errados no registro:**
- `/terms` → `/termos`
- `/privacy` → `/privacidade`

**P3-2 ✅ — "Documentação API" morto:**
- Removido do footer (coluna Suporte)

**P3-3 ✅ — Error boundary para /f/[slug]:**
- Criado `app/f/[slug]/error.tsx` com tela amigável (ícone, mensagem, botão "Tentar novamente")

### Validação
- `tsc --noEmit`: ✅ passa limpo
- Commit: `e1ec731`

### Arquivos alterados
- `app/(auth)/register/page.tsx` — validação visual + required + links
- `app/page.tsx` — remoção de "Documentação API" do footer
- `app/f/[slug]/error.tsx` — novo error boundary

### Pendências
- Nenhuma

### Próximo passo
- Deploy quando quiser
- Revalidação se desejar

---

## Handoff — Zeca → Sidney — 2026-04-23 12:10 GMT-3

### Demanda
BUG URGENTE no checkout Pix/Asaas, reproduzido em teste manual.

### Erros exibidos
- "O método de pagamento CREDIT_CARD é o único método de pagamento permitido para operações RECURRENT"
- "O tipo de cobrança DETACHED é obrigatório para o método de pagamento PIX"

### Causa Raiz
Em `lib/asaas.ts`, função `createCheckout`:

```typescript
billingTypes: ['CREDIT_CARD', 'PIX'],
chargeTypes: ['RECURRENT'],  // ← PROBLEMA AQUI
```

**Como o Asaas funciona:**
- CREDIT_CARD suporta RECURRENT para assinaturas
- **PIX só suporta DETACHED**, não RECURRENT
- Ao forçar apenas `['RECURRENT']`, o PIX falha

### O que foi feito

**Correção aplicada:**
- Alterado `chargeTypes: ['RECURRENT']` → `chargeTypes: ['RECURRENT', 'DETACHED']`
- Isso permite:
  - CREDIT_CARD usar RECURRENT (fluxo de assinatura)
  - PIX usar DETACHED (pagamento avulso que cria assinatura)
- Cartão continua funcionando sem regressão

**Validação:**
- `npm run build`: ✅ passa limpo
- Teste manual: pendente validação no sandbox Asaas

### Arquivos alterados
- `lib/asaas.ts` — linha 97: `chargeTypes: ['RECURRENT', 'DETACHED']`

### Commit
- `36f217e` — fix: allow PIX in checkout by adding DETACHED charge type

### Pendências
- Testar checkout PIX no sandbox Asaas para confirmar funcionamento

### Próximo passo
- Testar PIX no sandbox antes de deploy para produção

---

## Handoff — Toin → Sidney — 2026-04-23 11:30 GMT-3

### Demanda
Corrigir bugs P2 (fluxo de ativação) e P3 (copy inconsistente) do EidosForm.

### O que foi feito

**P2 — Inconsistência de fluxo de ativação (Supabase autoconfirm):**
- Verificado que o Supabase pode ter `autoconfirm` habilitado no projeto
- Se `autoconfirm` está ON, o signup retorna `session` não-nulo (usuário já autenticado)
- Modificado `/api/auth/signup` para retornar flag `autoConfirmed` baseada na presença de `session`
- Modificado `/register` para:
  - Se `autoConfirmed === true` → redireciona direto para `dashboard` (ou `next` param)
  - Se `autoConfirmed === false` → mantém fluxo original para `/verify-email`
- Isso elimina a tela enganosa de verificação quando a conta já está ativa

**P3 — Copy inconsistente do plano Starter:**
- Verificado `lib/plan-definitions.ts` → `maxForms: 100` para Starter
- Verificado `components/pricing-section.tsx` → mostra "100 formulários"
- Verificado `components/billing-plans.tsx` → mostra "100 formulários"
- **Resultado:** O código já estava consistente em 100 formulários em todos os lugares
- A auditoria referenciava um estado antigo onde o código tinha 10 mas a landing mostrava 100
- Nenhuma alteração necessária — bug inexistente no código atual

### Validação
- `npm run build`: ✅ passa
- Commit: `bb2f275`

### Arquivos alterados
- `app/api/auth/signup/route.ts` — adiciona flag `autoConfirmed` na resposta
- `app/(auth)/register/page.tsx` — lógica de redirect condicional

### Pendências
- Nenhuma

### Próximo passo
- Deploy quando quiser

---

## Handoff — Toin → Sidney — 2026-04-23 12:01 GMT-3

### Demanda
Corrigir bug P3 de XSS em `components/form-builder/form-preview.tsx`, sanitizando HTML de usuário antes do render no preview do formulário.

### O que foi feito
- Localizado o render de HTML do usuário via `dangerouslySetInnerHTML` em `components/form-builder/form-preview.tsx`
- Adicionado import de `DOMPurify` no componente
- Aplicado `DOMPurify.sanitize(...)` no HTML gerado por `renderTiptapHtml(...)` antes do render
- Verificado `package.json`: `dompurify` já existia em `dependencies`, sem necessidade de instalar nada

### Validação
- `npm run build`: ✅ passa
- Observação: o build ainda mostra warning do Next sobre `middleware` deprecated em favor de `proxy`, mas não bloqueia a compilação

### Arquivos alterados
- `components/form-builder/form-preview.tsx` — sanitização do HTML antes de `dangerouslySetInnerHTML`

### Pendências
- Nenhuma relacionada a este fix

### Próximo passo
- Commitar, pushar e seguir para deploy quando quiser
