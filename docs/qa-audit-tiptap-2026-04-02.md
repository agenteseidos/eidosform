# Auditoria de QA — Tiptap no Bloco de Conteúdo

**Auditora:** Zéfa
**Data:** 2026-04-02
**Escopo:** Commits `7dd07cb`..`ac6c832` (4 commits)

---

## 1. Checklist de Build

| Verificação | Resultado |
|---|---|
| `npx tsc --noEmit` | **PASS** — zero erros |
| `npm run build` (Next.js 16.1.1 Turbopack) | **PASS** — compiled em 38.8s, 29 páginas estáticas |

---

## 2. Arquivos Alterados (11 arquivos, +1467 / −233 linhas)

| Arquivo | Mudança |
|---|---|
| `components/ui/tiptap/TiptapEditor.tsx` | **NOVO** — editor Tiptap + helpers + renderTiptapHtml |
| `lib/content-block.ts` | **NOVO** — renderContentBlockHtml + getContentBlockPreview |
| `components/form-player/form-player.tsx` | Refactor auto-advance, CTA condicional, keyboard blocker |
| `components/form-player/question-renderer.tsx` | valueOverride em onSubmit, renderTiptapHtml no content_block |
| `components/form-builder/form-preview.tsx` | TiptapEditor inline, content_block sem título/descrição |
| `components/form-builder/question-editor.tsx` | Remove Textarea do content_block, instrução inline |
| `components/form-builder/right-panel.tsx` | Preview via getContentBlockPreview, oculta "obrigatório" |
| `components/form-builder/form-builder.tsx` | Sidebar usa getContentBlockPreview |
| `lib/questions.ts` | Ajuste menor |
| `package.json` / `package-lock.json` | +4 deps Tiptap |

---

## 3. Análise por Área

### 3.1 Tiptap — Serialização JSON/HTML

- **`normalizeTiptapContent()`** — Detecta JSON (`isTiptapJson`) vs Markdown legado e normaliza. Funciona corretamente como gateway bidirecional.
- **`renderTiptapHtml()`** — Usa `generateHTML` do `@tiptap/core` para JSON, cai no fallback markdown para conteúdo legado. Correto.
- **`markdownToTiptap()`** — Converte bold/italic/bullets de markdown para nós Tiptap. Parser simples mas funcional para o escopo.
- **Editor `useEditor`** — Cleanup no unmount é gerenciado internamente pelo hook `useEditor` do `@tiptap/react`. Nenhum leak identificado.
- **Sync externo** — `useEffect([value, editor])` compara JSON serializado para evitar loops infinitos de `setContent`. Correto.

### 3.2 content_block no Player

- **Título/descrição ocultos** para `isContentStep` — evita duplicar com o corpo do content_block. Correto.
- **CTA global oculto** — content_block tem seu próprio botão via `question-renderer.tsx`. Elimina duplicação de CTA.
- **Botão "next" (chevron)** no rodapé — oculto para content_block. Correto.
- **Keyboard** — Enter e ArrowDown bloqueados para content_block (avanço apenas via botão). ArrowUp funciona para voltar. Decisão de UX intencional.
- **`onSubmit(true, 'viewed')`** — Todas as 3 variantes do botão (com URL, sem URL, sem texto) passam o valueOverride. Consistente.

### 3.3 content_block no Builder

- **TiptapEditor inline** com `clickToEdit` — edição ativada ao clicar, BubbleMenu ao selecionar texto.
- **Sidebar** usa `getContentBlockPreview()` que extrai texto puro de JSON Tiptap ou strip markdown. Correto.
- **Right panel** oculta toggle "obrigatório" para content_block. Correto.
- **QuestionEditor** remove Textarea, mostra instrução de edição inline. Correto.

### 3.4 Sanitização HTML / XSS

| Ponto de uso | Mecanismo | Seguro? |
|---|---|---|
| `question-renderer.tsx:981` — `dangerouslySetInnerHTML` | `renderTiptapHtml()` → `generateHTML` (Tiptap JSON) ou `renderContentBlockHtml` (markdown) | **SIM** — `generateHTML` produz HTML controlado a partir de nós tipados; fallback usa `escapeHtml` antes de aplicar `<strong>`/`<em>` |
| `form-preview.tsx:295` — `dangerouslySetInnerHTML` (read-only) | `renderTiptapHtml()` → `generateHTML` (Tiptap JSON) ou `renderContentBlockHtml` (markdown) | **SIM** — corrigido em `472ea1e`; mesma cadeia segura do player |
| `content-block.ts:escapeHtml()` | Escapa `& < > " '` | **SIM** — cobre OWASP top entities |
| Tiptap `generateHTML` | Só gera HTML para node types registrados (StarterKit) | **SIM** — tipos desconhecidos ignorados, texto escapado pelo ProseMirror |

**Nenhuma vulnerabilidade XSS identificada.**

### 3.5 Auto-advance — Fix de Stale Answers

O fix introduz o padrão `PendingAnswerOverride`:
1. `onSubmit(skipValidation, valueOverride)` — passa o valor selecionado diretamente
2. `goToNext(skipValidation, pendingAnswer)` — monta `updatedAnswers` com merge do valor pendente
3. `validateCurrentQuestion(candidateAnswers)` — valida contra answers atualizadas, não o state stale
4. `handleSubmit(submissionAnswers)` — submete com answers finais

**Race condition resolvida corretamente.** Antes, `onChange(option); onSubmit(true)` dependia do batch do React. Agora o valor é passado explicitamente.

### 3.6 Pixel Events — Duplicação Removida

Antes: pixel events condicionais da última pergunta eram avaliados **duas vezes** (em `goToNext` e em `handleSubmit`).
Agora: avaliados apenas em `goToNext`, com `updatedAnswers` contendo o valor fresco. A duplicação em `handleSubmit` foi removida.
**Regressão eliminada.**

---

## 4. Bugs Encontrados

### P1 — Funcionalidade Quebrada (latente)

| # | Local | Descrição | Impacto | Correção |
|---|---|---|---|---|
| P1-1 | `form-preview.tsx:294` | Fallback read-only usa `renderContentBlockHtml()` em vez de `renderTiptapHtml()`. Se `FormPreview` for renderizado sem `onUpdateQuestion`, conteúdo Tiptap JSON aparecerá como texto cru. | **Latente** — builder sempre passa `onUpdateQuestion`, mas o componente aceita o prop como opcional. | Trocar para `renderTiptapHtml(question.contentBody, renderContentBlockHtml)` |

### P2 — Degradação Menor

| # | Local | Descrição |
|---|---|---|
| P2-1 | `TiptapEditor.tsx:5,276` | Import duplicado de `@tiptap/starter-kit` (`StarterKit` e `StarterKitPkg`). Funciona, mas é code smell. |
| P2-2 | `form-preview.tsx:287-288` | `onChange` + `onBlur` ambos chamam `onUpdateQuestion`. onChange dispara a cada keystroke, tornando onBlur redundante. Sem bug funcional, mas gera chamadas desnecessárias. |
| P2-3 | `form-player.tsx:274-277,292-295` | Enter/ArrowDown bloqueados para content_block. Acessibilidade via teclado limitada — respondente só avança via clique no botão. |

---

## 5. Pontos Positivos

- **Auto-advance**: fix sólido e bem arquitetado com `valueOverride`
- **Sanitização**: escapeHtml + generateHTML cobrem todos os vetores
- **Cleanup do Tiptap**: `useEditor` gerencia destroy automaticamente
- **Preview na sidebar**: `getContentBlockPreview` lida com JSON e Markdown
- **Separação de concerns**: `lib/content-block.ts` isola a lógica de rendering
- **Tiptap extensions**: StarterKit configurado com features mínimas (sem heading/blockquote/code), reduzindo superfície de ataque

---

## 6. Veredito

### APROVADO com ressalvas

- **0 bugs P0** (crash / data loss / security / build break)
- **1 bug P1** latente (fallback read-only no form-preview) — não afeta produção hoje mas deve ser corrigido no próximo sprint
- **3 itens P2** de code quality e acessibilidade

Os fixes de auto-advance, CTA duplicado e preview JSON cru estão todos corretos e bem implementados. A integração do Tiptap é segura contra XSS. O código está pronto para produção.

---

*Auditoria realizada por Zéfa — QA Bot do EidosForm*

---

## 7. Revalidação P1 — 2026-04-02

**Commit verificado:** `472ea1e` — *fix: usa renderTiptapHtml no fallback read-only do content_block no form-preview*

### Checklist

| Verificação | Resultado |
|---|---|
| `npx tsc --noEmit` | **PASS** — zero erros |
| Import `renderTiptapHtml` em `form-preview.tsx:10` | **OK** — `import { TiptapEditor, renderTiptapHtml } from '@/components/ui/tiptap/TiptapEditor'` |
| `form-preview.tsx:295` usa `renderTiptapHtml` | **OK** — `renderTiptapHtml(question.contentBody \|\| '...', renderContentBlockHtml)` |
| `renderTiptapHtml` exportada em `TiptapEditor.tsx:285` | **OK** — intacta no working copy, JSON → `generateHTML`, fallback → `renderContentBlockHtml` |
| Nenhum `dangerouslySetInnerHTML` com `renderContentBlockHtml` direto em `.tsx` | **OK** — zero ocorrências |
| Novos P0 introduzidos | **0** |
| Novos P1 introduzidos | **0** |

### Mudanças não-commitadas (3 arquivos — não afetam o P1 fix)

| Arquivo | Natureza | Risco |
|---|---|---|
| `question-editor.tsx` | Texto de ajuda atualizado | P2 cosmético |
| `right-panel.tsx` | ID técnico em seção colapsável | P2 UX |
| `TiptapEditor.tsx` | BubbleMenu → FixedToolbar (toolbar fixa no foco) | P2 UX — `renderTiptapHtml` inalterada |

### Veredito Final

**✅ APROVADO FINAL — ciclo QA encerrado**

- **P1-1 corrigido** — fallback read-only em `form-preview.tsx` agora usa `renderTiptapHtml` com `renderContentBlockHtml` como fallback markdown
- **0 bugs P0** (crash / data loss / security / build break)
- **0 bugs P1** remanescentes
- **3 itens P2** pré-existentes (import duplicado, onChange+onBlur redundante, acessibilidade teclado content_block)

*Revalidação realizada por Zéfa — QA Bot do EidosForm — 2026-04-02*

---

## 8. Auditoria Toolbar+Sidebar — 2026-04-02

**Commits auditados:**
- `64a1c3d` — *Fix content block editor toolbar UX*
- `472ea1e` — *fix: usa renderTiptapHtml no fallback read-only do content_block no form-preview*

**Escopo:** Toolbar do Tiptap (BubbleMenu → FixedToolbar), sidebar right-panel (ID técnico colapsável), help text atualizado.

### 8.1 Build

| Verificação | Resultado |
|---|---|
| `npx tsc --noEmit` | **PASS** — zero erros |

### 8.2 Toolbar Tiptap — BubbleMenu → FixedToolbar

| Aspecto | Antes | Depois | Avaliação |
|---|---|---|---|
| Componente | `BubbleMenu` (flutuante, posicionamento dinâmico) | `FixedToolbar` (div estático acima do editor) | **Melhoria** — elimina bugs de posicionamento do BubbleMenu |
| Visibilidade | `editable && isActive` (sempre visível com editor ativo) | `editable && isActive && hasFocus` (só no foco) | **Correto** — toolbar some ao sair do editor, menos poluição visual |
| z-index | `9999` (forçando stacking context) | `1` (inline, sem necessidade de z-index alto) | **Correto** — toolbar fixa não precisa competir com overlays |
| Posição | Flutuante acima da seleção (`placement: 'top', offset: 8`) | `mb-3 inline-flex` acima do EditorContent | **Correto** — posição previsível e estável |
| Anti-blur nos botões | `onMouseDown` com `e.preventDefault()` | Mantido idêntico | **OK** — clique nos botões não tira foco do editor |
| Focus chain | N/A | `editor.chain().focus().toggleBold().run()` | **OK** — cada ação re-foca o editor |
| Import `BubbleMenu` | `import { BubbleMenu } from '@tiptap/react/menus'` | **Removido** | **Correto** — import não utilizado eliminado |

**Estado `hasFocus`:**
- `onFocus` → `setHasFocus(true)` (linha 211-213)
- `onBlur` → `setHasFocus(false)` (linha 208)
- Toolbar renderizada condicionalmente: `editable && isActive && hasFocus` (linha 263)

**Fluxo de interação verificado:**
1. Usuário clica no content_block → `clickToEdit` ativa `isActive=true` → editor recebe foco → `hasFocus=true` → toolbar aparece
2. Usuário clica em botão Bold → `onMouseDown(e.preventDefault())` mantém foco → `editor.chain().focus()` garante → toolbar permanece
3. Usuário clica fora → `onBlur` → `hasFocus=false` → toolbar some
4. Valor salvo via `onBlur` callback → `onUpdateQuestion` chamado com JSON string

**Nenhum bug encontrado na toolbar.**

### 8.3 Sidebar — Right Panel

**Mudança:** ID técnico do campo agora em seção colapsável (fechada por padrão).

| Aspecto | Avaliação |
|---|---|
| Estado `showTechnicalId` (default `false`) | **OK** — esconde info técnica de uso raro |
| Toggle com `ChevronDown` + `rotate-180` | **OK** — indicador visual de estado correto |
| Botão `type="button"` no toggle | **OK** — previne submit acidental |
| Funcionalidade "Copiar ID" preservada | **OK** — `handleCopyId` intacto, mesmo fallback `execCommand` |
| Texto "Copiar ID" → "Copiar" | **OK** — mais conciso, contexto já claro pelo título da seção |
| Descrição auxiliar adicionada | **OK** — "Use só se precisar referenciar este bloco em automações ou suporte." |

**Nenhum bug encontrado no right-panel.**

### 8.4 Help Text — QuestionEditor

**Antes:** "Selecione texto para formatar (negrito, itálico, lista)."
**Depois:** "A toolbar aparece no topo do editor quando o bloco entra em foco."

**Avaliação:** Texto atualizado para refletir o novo paradigma (FixedToolbar no foco em vez de BubbleMenu na seleção). **Correto.**

### 8.5 Regressões verificadas

| Área | Status | Detalhe |
|---|---|---|
| `renderTiptapHtml` no player (`question-renderer.tsx:974`) | **Intacto** | `renderTiptapHtml(question.contentBody, renderContentBlockHtml)` |
| `renderTiptapHtml` no preview read-only (`form-preview.tsx:295`) | **Intacto** | Fix do P1-1 preservado — usa `renderTiptapHtml` com fallback correto |
| Auto-advance com fresh answers (`form-player.tsx`) | **Intacto** | Padrão `PendingAnswerOverride` + `updatedAnswers` sem alteração |
| CTA do content_block (3 variantes) | **Intacto** | Link externo, botão interno, default "Continuar" — todos passam `'viewed'` |
| `getContentBlockPreview` na sidebar (`form-builder.tsx:750`) | **Intacto** | Extrai texto puro de Tiptap JSON ou strip markdown |
| Sanitização XSS (`escapeHtml` + `generateHTML`) | **Intacto** | Cadeia segura sem alteração |
| `EditorContent` min-height | **Adicionado** | `[&_.ProseMirror]:min-h-[60px]` — melhora área clicável |

**Zero regressões detectadas.**

### 8.6 Classificação de Issues

| Severidade | Qtd | Detalhes |
|---|---|---|
| **P0** (crash/data loss/security/build break) | **0** | — |
| **P1** (funcionalidade quebrada) | **0** | — |
| **P2** (degradação menor) | **0 novos** | P2 pré-existentes (import duplicado StarterKit, onChange+onBlur redundante, acessibilidade teclado) inalterados |

### 8.7 Veredito

**✅ APROVADO — Toolbar + Sidebar limpos**

- BubbleMenu → FixedToolbar: melhoria sólida de UX, elimina problemas de posicionamento flutuante
- ID técnico colapsável: boa decisão de UX, esconde complexidade desnecessária
- Help text atualizado corretamente para o novo paradigma
- Zero regressões nos fixes anteriores (renderTiptapHtml, auto-advance, CTA, preview)
- Zero bugs novos (P0, P1 ou P2)
- Build (`tsc --noEmit`) passa limpo

*Auditoria realizada por Zéfa — QA Bot do EidosForm — 2026-04-02*
