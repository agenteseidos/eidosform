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
