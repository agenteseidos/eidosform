# Auditoria — Navegação, Lógica Condicional e Saltos (EidosForm)

**Data:** 2026-05-19
**Escopo:** `components/form-player/form-player.tsx`, `lib/form-logic-engine.ts`, `lib/jump-logic.ts`, `components/form-builder/jump-rules-editor.tsx`, lógica condicional em `components/form-builder/question-editor.tsx`, interações de teclado/opções em `components/form-player/question-renderer.tsx`.

## Resumo

O motor de navegação tinha uma falha estrutural: a posição atual do respondente
era guardada como **índice numérico** (`currentIndex`) dentro da lista de
perguntas visíveis. Essa lista é recalculada a cada resposta (lógica
condicional mostra/esconde perguntas), então o índice ficava apontando para a
pergunta errada — ou para fora da lista, causando tela branca. Quase todos os
bugs de "navegação maluca" com lógica condicional derivavam disso.

Esta auditoria corrige a raiz (posição passa a ser rastreada por **ID da
pergunta**) e mais um conjunto de bugs de borda.

---

## Bugs corrigidos nesta auditoria

### B1 — [CRÍTICO] Tela branca quando a lógica condicional esconde a pergunta atual
Se uma resposta fazia a lógica condicional ocultar a pergunta em que o
respondente estava (ou uma anterior), `currentIndex` passava a apontar para
fora da lista. O render acessava `currentQuestion.title` com `currentQuestion`
`undefined` → exceção → tela branca. O efeito de "clamp" só corrigia *depois*
do render que já tinha quebrado.
**Correção:** posição rastreada por ID; o índice é derivado e sempre saneado
antes do render.

### B2 — [CRÍTICO] Teleporte / "voltar" para a pergunta errada
`currentIndex` (número) e `navigationHistory` (lista de números) ficavam
obsoletos quando a lista de perguntas visíveis mudava de tamanho. Resultado:
ao revelar/ocultar uma pergunta, o respondente podia ser jogado para outra
pergunta; o botão "voltar" levava para a pergunta errada.
**Correção:** `currentQuestionId` (ID) como fonte de verdade e
`navigationHistory` passa a guardar IDs.

### B3 — [ALTO] Regra incompleta interpretada literalmente
- Exibição condicional com **pergunta não escolhida** (`questionId` vazio):
  `equals ''` dava verdadeiro → pergunta aparecia sempre; `not_equals`/`equals`
  com valor → comportamento aleatório; em alguns casos a pergunta **sumia**.
- Regra de salto com **destino não escolhido** (`targetQuestionId` vazio) era
  avaliada e "consumia" o fluxo de forma silenciosa.
**Correção:** o motor ignora condições com `questionId` vazio (pergunta sempre
visível) e ignora regras de salto sem destino válido.

### B4 — [ALTO] Envio duplicado
`handleSubmit` podia rodar duas vezes (Enter + clique no botão, ou cliques
rápidos), gerando **duas respostas** no banco. Não havia trava de "envio em
andamento" síncrona.
**Correção:** trava via `ref` no início de `handleSubmit`.

### B5 — [MÉDIO] Salvamento de progresso parcial morria após uma validação falha
`isSubmittedRef` era marcado `true` logo no início de `handleSubmit`, antes da
validação. Se a validação falhava, o flag continuava `true` e o salvamento de
progresso parcial ficava desativado pelo resto da sessão.
**Correção:** `isSubmittedRef` só é marcado após o envio bem-sucedido.

### B6 — [MÉDIO] Salto para pergunta oculta falhava em silêncio
Um salto cujo destino estava oculto por lógica condicional era descartado sem
aviso e o fluxo caía na próxima pergunta sequencial.
**Correção:** registra `console.warn` para o dono do formulário diagnosticar;
comportamento de fallback mantido (segue sequencial).

### B7 — [MÉDIO] "É igual a" em caixas de seleção quase nunca casa
Em `checkboxes`, múltiplas seleções viram a string `"a, b, c"`. O operador
`equals` compara a string inteira, então `equals "a"` dá falso quando há mais
de uma seleção. O editor oferecia `equals` como padrão, induzindo erro.
**Correção:** para `checkboxes`, o editor de regras passa a sugerir/!default
`contains`.

## Bugs já corrigidos antes desta auditoria (mesma frente, sessão 2026-05-18/19)
- Salto para pergunta condicional falhava por lista de visíveis defasada — `db80f5c`
- Enter não avançava em telas de checkbox — `b6d99dc`
- Enter marcava a opção em foco em vez de avançar — `6cea273`
- Envio exigia perguntas puladas por salto — `2349ab3`
- Bloco de conteúdo gravava `'viewed'` e quebrava a condição "está vazio" — `34d05f6`

### B11 — [ALTO, lado do produto] Pergunta com salto deveria ser obrigatória
Uma pergunta de roteamento (com regras de salto) que **não** é obrigatória
pode ser avançada sem resposta — aí nenhuma regra de salto casa e o fluxo
"fura" o roteamento, caindo na próxima pergunta sequencial. O construtor
deveria **forçar `required` quando há regras de salto** (ou ao menos avisar).
**Status:** não implementado no construtor (recomendação). Mitigado nos
formulários afetados marcando as perguntas de salto como obrigatórias.

## Verificação

Refatoração validada end-to-end no player (Playwright) com o formulário de
qualificação real (ramificações por `dropdown`, `yes_no`, `checkboxes`,
lógica condicional e 3 blocos de conteúdo):
- 5 caminhos percorridos — roteamento correto, nenhum crash, todos encerram.
- Botão "voltar" percorre o histórico na ordem certa.
- `npm run build`, `tsc` e 8 testes de `lib/form-logic-engine` passando.

## Itens observados, não corrigidos (baixo impacto)
- **B8** — `ArrowDown` dentro de `textarea` (texto longo) avança o formulário em
  vez de mover o cursor.
- **B9** — Barra de progresso e contador "Pergunta X de Y" não descontam
  perguntas puladas por salto; formulários com muitos saltos não chegam a 100%.
- **B10** — `getVisibleQuestions` devolve um array novo a cada render, fazendo
  `useEffect`s de posição dispararem em todo render (custo, não erro).
