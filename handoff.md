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
