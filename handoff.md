## Handoff — Zéfa — 2026-04-22 18:15 GMT-3

### Demanda
Auditoria completa do builder do EidosForm: fluxo de criação/edição, UX, bugs, edge cases, impacto em vendas.

### O que foi feito
Leitura completa de todo o código do builder (form-builder.tsx 1799 linhas, right-panel.tsx, question-editor.tsx, form-preview.tsx, jump-rules-editor.tsx, pixel-event-rules-editor.tsx, whatsapp-panel.tsx), páginas de rotas (new, edit, builder redirect), API de forms (GET/PATCH), formulário público (/f/[slug]). Não foi possível testar via browser pois não há sessão de browser ativa neste contexto.

---

## Relatório de Auditoria do Builder

### Visão Geral

O builder é funcional e bem estruturado. Tem autosave, preview inline, edição de propriedades, reordenação drag-and-drop, e fluxo de publicação. Arquitetura é sólida com componentes separados. Porém há problemas de UX, bugs funcionais e gaps que impactam a capacidade de vender.

---

### 🐛 Bugs Encontrados

#### P0 — Crítico (bloqueia venda)

**(nenhum encontrado)**

O builder não tem bugs críticos que impeçam criar, editar e publicar um formulário básico.

#### P1 — Alto

| ID | Descrição | Arquivo/Linha | Impacto |
|---|---|---|---|
| **P1-1** | **Autosave falha silenciosamente** — se o autosave via Supabase direto falhar, não há toast de erro, apenas muda `saveStatus` para `idle`. Usuário perde alterações sem saber. | `form-builder.tsx` ~332-340 | Usuário pode perder trabalho sem aviso. Parece salvo mas não está. |
| **P1-2** | **Autosave não sincroniza com Google Sheets** — o autosave via Supabase direto (linha ~325) não chama a API `/api/forms/[id]`, então quando `google_sheets_enabled=true` e não tem `google_sheets_id`, o autosave ignora a criação da spreadsheet. Só funciona no save manual. | `form-builder.tsx` ~315-340 | Fluxo de Google Sheets pode quebrar se usuário depender do autosave. |
| **P1-3** | **`is_published` enviado no payload de publish mas ignorado pela API** — `handlePublish` envia `is_published: true` mas o PATCH `/api/forms/[id]` não inclui `is_published` na query de update. O campo nunca é persistido. Funciona porque a API filtra por `status = 'published'`, mas é um campo morto no código. | `form-builder.tsx` ~487, `app/api/forms/[id]/route.ts` | Confusão técnica; pode causar bugs futuros se alguém confiar em `is_published`. |

#### P2 — Médio

| ID | Descrição | Arquivo/Linha | Impacto |
|---|---|---|---|
| **P2-1** | **Slug editável sem validação de unicidade em tempo real** — usuário pode mudar o slug na aba "Compartilhar" mas só descobre se está duplicado ao salvar/publicar. Não há feedback visual de conflito. | `form-builder.tsx` ~1420 | Slug duplicado causa erro ao salvar; UX ruim. |
| **P2-2** | **Botão "Publicar" não mostra preview da URL no mobile** — o dialog de publish mostra o link, mas no mobile o botão de publicar só mostra ícone (texto `hidden sm:inline`). Sem contexto do que será publicado. | `form-builder.tsx` ~705 | UX mobile degradada. |
| **P2-3** | **Deletar pergunta sem confirmação** — `deleteQuestion` remove imediatamente, sem dialog de confirmação. Se usuário clicar acidentalmente no ícone de lixeira, perde a pergunta. | `form-builder.tsx` ~468 | Perda acidental de dados; sem undo. |
| **P2-4** | **Opções de dropdown/checkboxes — remoção da última opção** — no preview, o botão de remover opção é desabilitado quando há apenas 1 opção (`(question.options?.length || 0) > 1`), mas no editor lateral (QuestionEditor) não há essa proteção. Se todas as opções forem removidas, o formulário quebra ao renderizar. | `form-preview.tsx` vs `question-editor.tsx` | Pode criar formulário quebrado publicamente. |
| **P2-5** | **`handleAutosave` duplicado com `buildFormPayload`** — o autosave constrói o payload manualmente (linhas ~310-348) enquanto `buildFormPayload` (linha ~370) faz a mesma coisa. Se um campo novo for adicionado em um e esquecido no outro, dados se perdem. | `form-builder.tsx` ~310 vs ~370 | Manutenção frágil; risco de inconsistência. |
| **P2-6** | **Formulário "Sem título" como padrão sem forçar rename** — novo formulário é criado como "Formulário sem título" e pode ser publicado assim. Link `/f/[slug-aleatório]` com título genérico. | `forms/new/page.tsx` ~30 | Publicação sem título fica amador; impacta percepção do cliente. |
| **P2-7** | **Conteúdo do panel de WhatsApp usa `settings={null}`** — o `WhatsAppPanel` é chamado com `settings={null}`, o que pode impedir carregamento de configurações existentes. | `form-builder.tsx` ~1315 | WhatsApp config pode não persistir/loaded corretamente. |

#### P3 — Baixo

| ID | Descrição | Arquivo/Linha | Impacto |
|---|---|---|---|
| **P3-1** | **Ícones duplicados no import** — `FileText` e `Pencil` são importados e usados em múltiplos contextos, mas `TextCursorInput` aparece no mapeamento de tipos visuais mas não no import principal (está em outro bloco). | `form-builder.tsx` ~27-62 | Pouco impacto; código limpo. |
| **P3-2** | **`eslint-disable-next-line` em `QuestionReorderItem`** — prop `children` marcada como unused. Remover o prop ou usar. | `form-builder.tsx` ~119 | Aviso de lint. |
| **P3-3** | **Preview não mostra validação de campos obrigatórios** — o preview mostra asterisco `*` mas não simula erro de validação. Usuário não vê como fica a experiência de erro. | `form-preview.tsx` | UX de preview incompleta. |
| **P3-4** | **Sem tooltip/accessibilidade nos botões de ação rápida** — duplicar/deletar no hover não têm aria-label. | `form-builder.tsx` ~142 | Acessibilidade. |
| **P3-5** | **Rota `/forms/[id]/builder` é redirect para `/forms/[id]/edit`** — compatibilidade, mas pode confundir se houver links antigos para `/builder`. | `forms/[id]/builder/page.tsx` | Sem impacto funcional. |

---

### 📊 Análise de UX

#### Pontos Fortes
1. **Autosave com debounce (1.5s)** — bom padrão
2. **Preview inline com edição ao vivo** — título, descrição, placeholder editáveis no preview
3. **Reordenação drag-and-drop** — framer-motion Reorder bem implementado
4. **Editor de conteúdo rich (Tiptap)** — para content blocks
5. **Agrupamento de campos por categoria** no dialog de adicionar
6. **Feedback visual de save status** (Salvando... / Salvo ✓)
7. **Dialog de confirmação ao sair com mudanças não salvas**
8. **Mobile bottom navigation** com 3 painéis
9. **Badge de status (Rascunho / Publicado)** no header
10. **CTA de publish com animação pulsante quando há mudanças**

#### Pontos Fracos
1. **Mobile: botão Publicar só mostra ícone** — sem texto, sem contexto
2. **Sem undo/redo** — deletar pergunta é irreversível
3. **Sem busca/filtro de perguntas** — com muitos campos, fica difícil navegar
4. **Sem template de formulário** — novo form começa vazio, sem sugestões
5. **Sem atalhos de teclado** — Ctrl+S para salvar, Delete para remover, etc.
6. **Tema só tem seleção de preset** — sem customização de cores/fontes individual
7. **Slug aleatório por padrão** — novo form recebe slug random como `a3x7k2m1`

---

### 🔍 Pontos Técnicos

| Área | Status | Observações |
|---|---|---|
| Autosave | ⚠️ Funciona mas frágil | Payload duplicado; sem toast de erro no autosave direto |
| Publicação | ✅ Funciona | `status` muda para `published`; formulário fica acessível |
| Preview | ✅ Bom | Modos "Completo" e "Passo a passo"; edição inline |
| Drag & Drop | ✅ Funciona | framer-motion Reorder |
| Edição inline | ✅ Bom | Tiptap para content blocks, InlineEditableText para títulos |
| Integrações | ✅ Estruturado | Meta Pixel, Google Ads, TikTok, GTM, Sheets, Webhook, WhatsApp, Email |
| Validação de slug | ✅ | Regex no servidor; sem validação client-side de unicidade |
| Google Sheets | ⚠️ | Conexão funciona mas autosave não cria spreadsheet |
| Limites de plano | ✅ | `checkFormLimit` enforced na criação; features gated por plano |

---

### 📋 Ordem Sugerida de Ataque

**Fase 1 — Estabilidade (P1 + P2 críticos)**
1. **P1-1**: Toast de erro no autosave — simples, alto impacto
2. **P1-2**: Unificar autosave para usar sempre a API (ou remover Google Sheets do autosave path)
3. **P2-5**: Eliminar payload duplicado — usar só `buildFormPayload` no autosave
4. **P2-3**: Confirmação antes de deletar pergunta
5. **P2-4**: Proteger contra remoção de todas as opções no editor lateral

**Fase 2 — UX que impacta vendas (P2)**
6. **P2-6**: Forçar título antes de publicar (ou pelo menos warning)
7. **P2-1**: Validação de slug em tempo real (debounced)
8. **P2-2**: Melhorar botão Publicar no mobile
9. **P2-7**: Investigar se WhatsApp settings carrega corretamente

**Fase 3 — Polimento (P3)**
10. P3-3: Preview com simulação de validação
11. P3-4: Acessibilidade nos botões
12. P3-1/P3-2: Limpeza de código

---

### Limitações desta Auditoria
- **Não testei via browser** — não há sessão de browser ativa neste contexto. Validação de fluxo real (criar → editar → publicar → responder) requer browser.
- **Não testei Google Sheets E2E** — requer credenciais/service account.
- **Não testei WhatsApp E2E** — requer conexão ativa do WhatsApp.
- **Não testei fluxo mobile real** — análise baseada em código.

---

### Arquivos Auditados
- `components/form-builder/form-builder.tsx` — builder principal (1799 linhas)
- `components/form-builder/right-panel.tsx` — painel de propriedades
- `components/form-builder/question-editor.tsx` — editor de questão
- `components/form-builder/form-preview.tsx` — preview do formulário
- `components/form-builder/jump-rules-editor.tsx` — regras de salto
- `components/form-builder/pixel-event-rules-editor.tsx` — eventos de pixel
- `components/form-builder/whatsapp-panel.tsx` — painel WhatsApp
- `app/(dashboard)/forms/[id]/builder/page.tsx` — redirect para /edit
- `app/(dashboard)/forms/[id]/edit/page.tsx` — página do editor
- `app/(dashboard)/forms/new/page.tsx` — criação de formulário
- `app/api/forms/[id]/route.ts` — API GET/PATCH de formulário
- `app/f/[slug]/page.tsx` — formulário público

### Veredito
**Builder é funcional e bem construído.** Não há P0. 3 P1s relacionados a autosave (risco de perda de dados silenciosa). 7 P2s, maioria de UX. Arquitetura é boa mas tem duplicação de payload que é um risco de manutenção. Para vender com confiança: corrigir P1s (especialmente P1-1 autosave silencioso), adicionar confirmação de delete (P2-3), e forçar título antes de publicar (P2-6). O resto é polimento.
