# Auditoria Completa do Dashboard — EidosForm
**Data:** 2026-04-22  
**Auditora:** Zéfa  
**Escopo:** Dashboard (área logada)

---

## Resumo Executivo

O dashboard está funcional e com boa base visual. Encontrei **3 P0**, **5 P1**, **8 P2**, e **6 P3**. Os P0 são bugs concretos que afetam fluxos críticos. Os P1 são problemas de UX que geram confiança baixa. Os P2/P3 são melhorias importantes mas não bloqueantes.

---

## P0 — Críticos (quebram fluxo ou dados)

### P0-1: Botão "Voltar" na página de Respostas aponta para `/billing` em vez de `/forms`
- **Arquivo:** `components/responses/responses-dashboard.tsx` linha ~230
- **Problema:** `<Link href="/billing">` no botão Voltar da página de respostas. Deveria ser `/forms`.
- **Impacto:** Usuário clica em Voltar esperando voltar à listagem de formulários e vai parar na página de billing. Confunde totalmente.
- **Confiança:** 🔴 Alta — erro de navegação básico.

### P0-2: Botão "Voltar" na página de Billing aponta para `/billing` (loop)
- **Arquivo:** `app/(dashboard)/billing/page.tsx` linha ~43
- **Problema:** `<Link href="/billing">` no botão Voltar da própria página de billing. Clicar faz scroll ao topo (ou nada visível).
- **Impacto:** Usuário não consegue voltar de billing. Precisa usar o logo ou menu.
- **Confiança:** 🔴 Alta — navegação quebrada.

### P0-3: "Cancelar assinatura" e "Deletar conta" são `<button>` sem ação
- **Arquivo:** `app/(dashboard)/settings/page.tsx` linhas ~127 e ~133
- **Problema:** São botões HTML simples sem `onClick`, sem handler, sem nada. Clicar não faz absolutamente nada. Sem feedback, sem confirmação.
- **Impacto:** Usuário tenta cancelar/deletar e nada acontece. Gera frustração e desconfiança — parece que o sistema não funciona ou está enganando.
- **Confiança:** 🔴 Crítica — ações de conta quebradas = não confia.

---

## P1 — Alto (UX ruim, confunde ou gera desconfiança)

### P1-1: Ciclo de reset de respostas hardcoded em "1 de abril"
- **Arquivo:** `app/(dashboard)/billing/page.tsx` linha ~54
- **Problema:** `Ciclo reinicia em 1 de abril` está hardcoded. Para usuários que acessam em outros meses, a data é errada/misleading.
- **Impacto:** Usuário não sabe quando seu ciclo realmente reinicia. Pode pensar que já perdeu as respostas do mês.

### P1-2: Nenhuma confirmação de perfil salva no `ProfileSettings`
- **Arquivo:** `components/settings/profile-settings.tsx`
- **Problema:** Salva nome no `auth.metadata` mas NÃO salva na tabela `profiles`. Se a settings page carrega `full_name` do profile, o dado fica desincronizado — o nome muda no auth mas a página de settings (que lê do profile) não reflete a mudança.
- **Impacto:** Usuário salva o nome, vê que "funcionou" (toast), mas ao recarregar o nome antigo volta. Desconfiança.

### P1-3: Tabela de respostas sem paginação
- **Arquivo:** `components/responses/responses-dashboard.tsx`
- **Problema:** Carrega TODAS as respostas de uma vez em `getServerSideProps` + client state. Para formulários com muitas respostas (5000+ no plano Pro), a página fica lenta ou quebra.
- **Impacto:** Performance degrada com uso. Tela travada = dashboard inoperável.

### P1-4: Sidebar de pastas não existe no mobile
- **Arquivo:** `components/dashboard/dashboard-shell.tsx`
- **Problema:** A sidebar lateral com pastas usa `lg:block hidden`. No mobile, só tem um Select dropdown. Usuário não consegue criar pastas facilmente no mobile (tem um botão + pequeno que abre o dialog, mas a navegação entre pastas é só dropdown).
- **Impacto:** Organização de formulários no mobile é significativamente pior que desktop.

### P1-5: Mensagem "Você continuará no plano Free" aparece para TODOS os usuários
- **Arquivo:** `app/(dashboard)/settings/page.tsx` linha ~125
- **Problema:** O texto ao lado de "Cancelar assinatura" diz "Você continuará no plano Free" independente do plano atual. Se o usuário já é Free, a mensagem é sem sentido. Se é Plus, pode ser ok mas ainda é confusa.
- **Impacto:** Usuários Free veem "Cancelar assinatura" e "continuará no plano Free" — dupla confusão.

---

## P2 — Médio (funciona mas pode ser melhor)

### P2-1: Export CSV do lado do client (`exportToCSV`) existe mas não é usado
- **Arquivo:** `components/responses/responses-dashboard.tsx`
- **Problema:** Existe uma função `exportToCSV` client-side que faz CSV no browser, mas o botão usa `exportCSVFromAPI` que chama a API. O código morto não é um bug, mas indica que houve troca de estratégia sem limpeza.

### P2-2: `form_limit` no query param da URL pode ser exposto
- **Arquivo:** `app/(dashboard)/forms/new/page.tsx` linha ~24
- **Problema:** `redirect(`/forms?error=form_limit&usage=${formLimit.usage}&limit=${formLimit.limit}`)` expõe o uso e limite do plano na URL. Não é sensível, mas é feio e desnecessário.
- **Sugestão:** Usar só o error code e buscar os dados no client.

### P2-3: Sem feedback visual ao mover formulário entre pastas
- **Arquivo:** `components/dashboard/dashboard-shell.tsx` → `handleMoveToFolder`
- **Problema:** A otimista update funciona bem, mas o card não tem animação de transição entre pastas. O formulário some do grid atual e aparece instantaneamente na pasta destino (se o usuário navegar). Pode parecer que apagou.

### P2-4: Campo de busca nas respostas não busca por metadata (IP, UTM)
- **Arquivo:** `components/responses/responses-dashboard.tsx` → `filteredResponses`
- **Problema:** A busca só olha `answers`. Não busca por `utm_source`, `utm_campaign`, etc. Se o usuário quiser filtrar por UTM, não consegue.

### P2-5: Onboarding aparece para usuários com 0 formulários mas pode reaparecer
- **Arquivo:** `components/dashboard/onboarding-wrapper.tsx`
- **Problema:** Usa `localStorage` para dismiss. Se o usuário limpar cache/trocar navegador, vê o onboarding de novo. E se `forms.length === 0` mas o usuário já usou antes (deletou todos), aparece o onboarding de "novo usuário" de novo.

### P2-6: FormCard não mostra slug do formulário em nenhum lugar
- **Arquivo:** `components/dashboard/form-card.tsx`
- **Problema:** O slug (link público) não é exibido no card. O usuário precisa abrir o menu > Copiar link para saber o link. Mostrar o slug abaixo do título seria útil.

### P2-7: Templates Gallery aparece DUAS VEZES na empty state
- **Arquivo:** `app/(dashboard)/forms/page.tsx`
- **Problema:** No empty state (forms.length === 0), há um `<TemplatesGallery />` no header E outro dentro do Card vazio. Duas instâncias do mesmo botão "Templates" visíveis ao mesmo tempo.
- **Impacto:** Confusão visual — qual clicar?

### P2-8: `TemplatesGallery` no header aparece sempre, mesmo com formulários
- **Arquivo:** `app/(dashboard)/forms/page.tsx`
- **Problema:** O botão Templates no header (ao lado de "Meus Formulários") aparece mesmo quando o usuário já tem formulários. Num dashboard de uso diário, isso ocupa espaço desnecessário. O botão "Criar Formulário" já é o CTA principal.

---

## P3 — Baixo (polish, edge cases)

### P3-1: Avatar usa apenas as primeiras 2 letras do email
- **Arquivo:** `components/dashboard/nav.tsx`, `app/(dashboard)/settings/page.tsx`
- **Problema:** `user.email?.slice(0, 2).toUpperCase()` — para emails como "contato@empresa.com", o avatar mostra "CO" em vez do nome do usuário. Deveria usar as iniciais do nome se disponível.

### P3-2: Dropdown menu do avatar mostra "Meus Formulários" com ícone de User
- **Arquivo:** `components/dashboard/nav.tsx` linha ~67
- **Problema:** O item "Meus Formulários" no dropdown usa o ícone `User`. Deveria usar `FileText` ou similar para consistência.

### P3-3: Pagina `/dashboard` faz redirect silencioso
- **Arquivo:** `app/(dashboard)/page.tsx`
- **Problema:** Se o usuário navegar para `/dashboard`, é redirecionado para `/forms` via `redirect()`. Funciona, mas o ideal seria um redirect 301 para SEO/consistência.

### P3-4: BillingPlans - preço anual mostra "Economize até 40%" mas a matemática varia
- **Arquivo:** `components/billing-plans.tsx`
- **Problema:** Free: 0→0 = 0% economia. Starter: 49→29 = ~41%. Plus: 127→97 = ~24%. Professional: 257→197 = ~23%. O "até 40%" é preciso, mas enganoso para planos mais caros onde a economia é menor.

### P3-5: FormCard badge "Sem pasta" sempre visível ocupa espaço
- **Arquivo:** `components/dashboard/form-card.tsx`
- **Problema:** Badge de pasta aparece em todos os cards, mesmo quando o usuário não usa pastas. Ocupa espaço visual sem valor quando o feature não é usado.

### P3-6: `error.tsx` nas respostas existe mas é genérico (Next.js default provavelmente)
- **Arquivo:** `app/(dashboard)/forms/[id]/responses/error.tsx`
- **Problema:** Não verifiquei o conteúdo, mas se for o default do Next.js, a experiência de erro na página de respostas é pouco amigável.

---

## Ordem Sugerida de Ataque

| Ordem | ID | Esforço | Impacto |
|-------|-----|---------|---------|
| 1 | P0-1 | 1 min | Navegação corrigida nas respostas |
| 2 | P0-2 | 1 min | Navegação corrigida no billing |
| 3 | P0-3 | Médio | Botões funcionais ou removidos |
| 4 | P1-2 | Baixo | Sync de nome entre auth e profile |
| 5 | P1-1 | Baixo | Data de ciclo dinâmica |
| 6 | P1-5 | 5 min | Lógica condicional do texto |
| 7 | P2-7 | 2 min | Remover duplicata do Templates |
| 8 | P2-8 | 2 min | Condicionar Templates no header |
| 9 | P1-3 | Alto | Paginação na tabela de respostas |
| 10 | P2-6 | Baixo | Mostrar slug no card |
| 11 | P3-1 | Baixo | Iniciais do nome vs email |
| 12 | P3-2 | 1 min | Ícone correto no menu |
| 13 | P1-4 | Médio | Mobile sidebar drawer |
| 14 | Demais | Variado | Conforme disponibilidade |

---

## Notas Positivas

- **Arquitetura:** Separação clara entre pages (server) e componentes (client). Boa estrutura.
- **UX geral:** Toasts, confirm dialogs, optimistic updates, loading states — tudo bem implementado.
- **Consistência visual:** Cores, badges, e spacing são consistentes.
- **Folders:** Implementação completa com optimistic update e rollback em erro.
- **Mobile:** Botões com min-h-44px, touch targets adequados.
- **Settings:** Seções bem organizadas, CEP lookup, separação billing/profile.
- **Respostas:** Métricas, filtros, busca, detalhe individual, exportação, delete — feature completa.
