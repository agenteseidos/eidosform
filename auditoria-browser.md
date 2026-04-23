# Auditoria Browser — EidosForm (eidosform.com.br)

**Data:** 2026-04-23 02:00 GMT-3  
**Agente:** Zéfa  
**Status:** Parcial — bloqueada por falta de credenciais de acesso ao painel

> **⚠️ BLOQUEIO CRÍTICO:** Não foi possível re-autenticar após logout. A conta registrada (zefateste2026@gmail.com) exige confirmação por email. A conta principal (sidney@institutoeidos.com.br) não tem senha conhecida disponível para o agente. Fluxos 4-12 foram parcialmente observados durante a sessão inicial auto-logada mas não puderam ser testados completamente.

---

## Fluxo 1 — Landing Page ✅

### Testes realizados:
- ✅ Página carrega corretamente em eidosform.com.br
- ✅ Hero section com headline, descrição e CTAs
- ✅ Seção "Recursos" com 6 features (Builder Visual, Analytics, Design, Domínio, API, Segurança)
- ✅ Seção "Como funciona" com 3 passos
- ✅ Seção "Preços" com 4 planos (Free, Starter R$29, Plus R$97, Professional R$197)
- ✅ Toggle Mensal/Anual funciona
- ✅ FAQ com 6 perguntas (expandíveis via `<details>`)
- ✅ CTA final
- ✅ Footer com links organizados (Produto, Suporte, Legal)
- ✅ Links internos funcionam: /login, /register, #recursos, #como-funciona, #precos, #faq
- ✅ Links /privacidade e /termos funcionam (páginas completas com LGPD)
- ✅ Links /terms e /privacy redirecionam para /termos e /privacidade (funcional mas URLs inconsistentes)
- ✅ OG meta tags presentes
- ✅ Favicon e apple-touch-icon presentes

### Bugs encontrados:
- **P3:** Links "termos de uso" e "política de privacidade" na página de registro apontam para `/terms` e `/privacy` (inglês), mas as páginas reais são `/termos` e `/privacidade` (português). Funciona via redirect mas é inconsistente.
- **P3:** "Documentação API" no footer é texto estático com `cursor-not-allowed`, não é um link. Deveria ser um link ou ser removido.
- **P3:** Claim "Segurança enterprise" na landing menciona "criptografia end-to-end" mas na página de privacidade menciona "criptografia end-to-end" — a landing exibe a versão completa enquanto em 375px exibe "criptografia em trânsito (TLS)". Inconsistência de copy.

### Observações:
- "Economize até 40%" no desktop, mas em 375px mostra "Economize até 41%". **Inconsistência de cálculo.**
- No plano Starter, a landing diz "100 formulários" mas o código-fonte do PricingSection diz "10 formulários". Provavelmente o código foi atualizado e não foi deployado, ou vice-versa.
- No plano Professional, a landing não lista "Notificação por WhatsApp" mas o código-fonte original a listava. Pode ter sido removido recentemente.
- "Marca d'água EidosForm" aparece nos planos Free e Starter — correto.
- FAQ usa `<details>` nativo do HTML — bom para acessibilidade.

---

## Fluxo 2 — Cadastro e Login ⚠️

### Testes realizados:
- ✅ Formulário de registro em /register com campos: Nome, Email, Senha, Confirmar Senha, Checkbox termos
- ✅ "Cadastrar com Google" presente
- ✅ Registro com dados válidos funciona (redireciona para "Verifique seu e-mail")
- ✅ "Reenviar e-mail" presente na tela de verificação
- ✅ Logout funciona
- ✅ Página de login em /login com Email, Senha, "Esqueci minha senha", Google login
- ✅ "Esqueceu a senha" (/forgot-password) funciona — mostra "E-mail enviado"
- ✅ Links para cadastro e login corretos

### Bugs encontrados:
- **P1:** **Nenhuma validação client-side no formulário de registro.** Todos os campos têm `required: false`. Ao clicar "Criar conta" com campos vazios, não aparece nenhuma mensagem de erro visual. O formulário simplesmente não faz nada.
- **P1:** **Sem feedback visual ao submeter com erros.** Não há mensagens de erro, bordas vermelhas, ou qualquer indicação de que algo deu errado.
- **P2:** Após registro bem-sucedido, a tela diz "Verifique seu e-mail" mas a conta parece auto-ativada (primeiro registro redirecionou direto pro dashboard). Inconsistência no fluxo.
- **P2:** Login com credenciais inválidas não mostra mensagem de erro clara (testado via Supabase API — retorna 400 mas a UI não exibe o erro).

### Não testado:
- Login bem-sucedido (bloqueado por falta de senha)
- "Esqueceu a senha" — fluxo completo (não acessa email)
- Validação de email inválido client-side
- Validação de senha curta client-side

---

## Fluxo 3 — Onboarding ❌

### Testes realizados:
- ❌ **Onboarding NÃO apareceu** após primeiro login (via auto-login pós-registro)

### Bugs encontrados:
- **P2:** Onboarding não é exibido para novos usuários. O código do componente `onboarding-modal.tsx` existe mas não é acionado.

---

## Fluxo 4 — Dashboard ⚠️ (observado parcialmente)

### O que foi observado durante a sessão inicial:
- ✅ Dashboard em /forms com lista de formulários
- ✅ 3 formulários existentes visíveis (todos com status "Rascunho")
- ✅ Cada formulário mostra: título, data de atualização, slug, status, pasta, número de respostas
- ✅ Botões "Editar" e "Respostas" por formulário
- ✅ Header com: "Meus Formulários", "Criar Formulário", "Fazer upgrade", Avatar
- ✅ Menu do avatar: "Meus Formulários", "Planos & Cobrança", "Configurações", "Sair"
- ✅ Filtros: "Todos (3)", "Ver pastas", "Nova pasta"
- ✅ Botão "Templates" presente

### Não testado (sem acesso):
- Criação de pasta
- Mover formulário para pasta
- Navegação completa do menu
- Página de Settings
- Página de Billing

---

## Fluxo 5 — Criar Formulário 🔒

**Não testado** — requer autenticação.

---

## Fluxo 6 — Preencher Formulário 🔒

### Testes parciais:
- ✅ Formulário não publicado (rascunho) mostra "Formulário não encontrado"
- ✅ Slug inexistente mostra "Formulário não encontrado" com botão "Ir para a página inicial"
- ⚠️ Slug `/f/2hfc9ap0` (form antigo da memória) mostra erro genérico "This page couldn't load" — página de erro do Next.js, não é a tela amigável customizada

### Bugs encontrados:
- **P3:** Slug `/f/2hfc9ap0` retorna página de erro genérica do Next.js em vez da tela amigável "Formulário não encontrado".

---

## Fluxo 7 — Ver Respostas 🔒

**Não testado** — requer autenticação.

---

## Fluxo 8 — Editar Formulário 🔒

**Não testado** — requer autenticação.

---

## Fluxo 9 — Duplicar e Excluir 🔒

**Não testado** — requer autenticação.

---

## Fluxo 10 — Settings / Perfil 🔒

**Não testado** — requer autenticação.

---

## Fluxo 11 — Embed / Share 🔒

**Não testado** — requer autenticação.

---

## Fluxo 12 — Mobile (375px) ⚠️

### Testes realizados:
- ✅ Landing page carrega em 375px
- ✅ Login page renderiza OK em 375px
- ✅ Botões são visíveis e parecem clicáveis

### Bugs encontrados:
- **P2:** **Dupla navegação visível** em 375px — tanto o menu mobile quanto o menu desktop aparecem simultaneamente na landing page.
- **P3:** "Economize até 41%" em mobile vs "Economize até 40%" em desktop — inconsistência de cálculo do desconto anual.

### Não testado:
- Dashboard em mobile (sem auth)
- Form player em mobile (sem forms publicados)
- Menu mobile (não há hamburger menu visível)

---

## Fluxo 13 — Edge Cases ⚠️

### Testes realizados:
- ✅ Slug inexistente → tela amigável "Formulário não encontrado"
- ✅ Formulário rascunho → "Formulário não encontrado"
- ⚠️ Formulário com erro interno → página de erro genérica do Next.js

### Não testado:
- Criar form com título vazio (sem auth)
- Publicar sem perguntas (sem auth)
- Slug duplicado (sem auth)
- Enviar resposta com campos obrigatórios vazios (sem forms publicados)
- Browser back button em vários pontos

---

## Resumo de Bugs

### P0 (Críticos)
*nenhum encontrado*

### P1 (Altos)
| # | Bug | Fluxo |
|---|-----|-------|
| 1 | Nenhuma validação client-side no formulário de registro — campos com `required: false`, sem feedback visual | 2 |
| 2 | Sem mensagem de erro ao submeter registro com campos vazios | 2 |

### P2 (Médios)
| # | Bug | Fluxo |
|---|-----|-------|
| 3 | Onboarding não aparece para novos usuários | 3 |
| 4 | Inconsistência: registro diz "verifique email" mas conta é auto-ativada | 2 |
| 5 | Login com credenciais inválidas não mostra erro na UI | 2 |
| 6 | Dupla navegação (mobile + desktop) visível em 375px | 12 |

### P3 (Baixos)
| # | Bug | Fluxo |
|---|-----|-------|
| 7 | Links de termos/privacidade no registro usam URLs em inglês (/terms, /privacy) | 1 |
| 8 | "Documentação API" no footer é texto morto com cursor-not-allowed | 1 |
| 9 | Inconsistência de copy: "criptografia end-to-end" vs "criptografia em trânsito (TLS)" | 1 |
| 10 | "Economize 40%" vs "41%" inconsistente entre desktop e mobile | 12 |
| 11 | Slug antigo retorna página de erro genérica do Next.js | 6 |
| 12 | Inconsistência: Starter mostra "100 formulários" na landing vs "10" no código-fonte | 1 |

---

## Sugestões de Melhoria

1. **Adicionar validação HTML5 e visual** — usar `required` nos campos e exibir mensagens de erro claras (bordas vermelhas + texto)
2. **Corrigir dupla navegação mobile** — esconder menu desktop em viewports menores
3. **Implementar onboarding** — o componente existe mas não é acionado
4. **Unificar URLs** — usar sempre `/termos` e `/privacidade` (português)
5. **Tornar "Documentação API" um link** ou remover do footer
6. **Padronizar cálculo de desconto** — garantir que 40% (ou o valor correto) apareça em todos os breakpoints
7. **Padronizar mensagens de erro** — slug inválido deve sempre retornar a tela amigável, nunca a página de erro do Next.js
8. **Adicionar feedback de erro no login** — mostrar toast/message quando credenciais são inválidas
9. **Revisar copy entre landing e código** — sincronizar features dos planos

---

## Coverage

| Fluxo | Status | Detalhes |
|-------|--------|----------|
| 1. Landing | ✅ Completo | Todos os CTAs, links, seções testados |
| 2. Cadastro/Login | ⚠️ Parcial | Validação testada, login completo bloqueado |
| 3. Onboarding | ❌ Falhou | Não apareceu |
| 4. Dashboard | ⚠️ Parcial | Observado, não interagido |
| 5. Criar Form | 🔒 Bloqueado | Sem autenticação |
| 6. Preencher Form | ⚠️ Parcial | Edge cases testados, sem forms publicados |
| 7. Respostas | 🔒 Bloqueado | Sem autenticação |
| 8. Editar Form | 🔒 Bloqueado | Sem autenticação |
| 9. Duplicar/Excluir | 🔒 Bloqueado | Sem autenticação |
| 10. Settings | 🔒 Bloqueado | Sem autenticação |
| 11. Embed/Share | 🔒 Bloqueado | Sem autenticação |
| 12. Mobile | ⚠️ Parcial | Landing e login testados |
| 13. Edge Cases | ⚠️ Parcial | Slugs inexistentes testados |

**Coverage geral: ~35%** — limitado pela falta de credenciais de acesso ao painel administrativo.
