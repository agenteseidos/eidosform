# Auditoria de verificação das correções de UI/UX do Builder

**Data:** 2026-08-05  
**Commit verificado:** `237146effce891c05e0245a610297c9820213067`  
**Auditoria de origem:** `docs/auditoria-ui-builder-2026-08-05.md`  
**Método:** revisão do diff e do código em `main`, rastreamento dos fluxos até o player e o schema, reprodução por testes automatizados e análise das restrições CSS nos breakpoints. Nenhum código funcional foi alterado.

## Conclusão executiva

O lote corrige integralmente 6 dos 13 itens executados, corrige parcialmente 7 e mantém os 2 adiamentos autorizados. As proteções mais críticas de duplicação e ciclo estão funcionando. A exclusão ainda deixa referências órfãs em eventos por conjunto de respostas. Os quick wins de contraste, alvos de toque, ARIA, fallback do ELK e terminologia ficaram incompletos.

Duas regressões novas foram confirmadas:

1. O drawer de 768-1279 px não gerencia aba nem foco. Ele pode continuar aberto sobre Integrações/Compartilhar e perde o foco ao fechar.
2. O botão global de fechar Dialog passou a 44 px sem reservar espaço no cabeçalho. Títulos longos podem ficar sob o botão, inclusive nos títulos dinâmicos do mapa.

| Item | Veredito | Síntese |
|---|---|---|
| 1. Duplicação e regras de salto | **RESOLVIDO** | Clone profundo, IDs novos e condição própria re-apontada |
| 2. Ciclos de salto | **RESOLVIDO** | Alerta no mapa e limite de revisitas no player |
| 3. Layout de 768-1279 px | **PARCIAL** | Preview recuperado, mas o drawer introduz estado residual e perda de foco |
| 4. Edição por teclado | **ADIADO AUTORIZADO** | Fora do critério de aprovação desta rodada |
| 5. Altura dos modais | **RESOLVIDO** | Três diálogos ganharam limite e rolagem interna |
| 6. Exclusão de opções no touch | **PARCIAL** | Visível no touch, mas alvo tem cerca de 34 px e falta nome acessível |
| 7. Exclusão de pergunta referenciada | **PARCIAL** | Limpa saltos/visibilidade, mas não `answerSetEvents` |
| 8. Dados antigos no mapa | **RESOLVIDO** | Mescla dados novos preservando o estado dos nós |
| 9. Entrada da Lógica no mobile | **ADIADO AUTORIZADO** | Fora do critério de aprovação desta rodada |
| 10. Contraste e texto auxiliar | **PARCIAL** | Pontos importantes melhoraram, mas a passada não foi sistêmica |
| 11. Alvos e nomes acessíveis | **PARCIAL** | Switches citados e acordeões melhoraram; outros controles seguem pequenos/sem nome |
| 12. Autosave mobile | **RESOLVIDO** | Estado persistente visível e região `aria-live` |
| 13. Falha do ELK | **PARCIAL** | Há fallback, mas não há loading, aviso, retry ou estado de erro |
| 14. Terminologia | **PARCIAL** | “Ramificação” permanece na principal variação do editor |
| 15. Overflow de URL e regras | **RESOLVIDO** | Quebra explícita aplicada nos pontos auditados |

## Verificação detalhada

### 1. Duplicação de pergunta com salto: RESOLVIDO

- **Evidência:** `lib/question-integrity.ts:12-38`; uso em `components/form-builder/form-builder.tsx:891-899`.
- O objeto inteiro é clonado, pergunta, regras de salto e eventos de pixel recebem IDs novos, e uma condição que lia a própria pergunta passa a ler o ID da cópia.
- O cenário da auditoria está automatizado em `lib/question-integrity.test.ts:38-46`: original e cópia recebem respostas diferentes, e a cópia decide pela própria resposta.
- O fallback JSON não cria incompatibilidade com `QuestionConfig`. Seus campos são strings, números, booleanos, arrays e objetos JSON. Chaves opcionais com `undefined` podem ser omitidas no fallback, mas essa omissão é semanticamente equivalente à ausência já prevista pelo tipo. Não há funções, `Date`, `BigInt` ou outros valores não serializáveis em `QuestionConfig` (`lib/database.types.ts:91-116`).

### 2. Ciclo A para B para A: RESOLVIDO

- **Evidência no mapa:** `lib/logic-graph.ts:255-282`. Para cada salto, o código verifica se o destino alcança novamente a origem por salto ou sequência e emite “Laço no fluxo”.
- **Evidência no player:** `components/form-player/form-player.tsx:39-42`, `components/form-player/form-player.tsx:136-139` e `components/form-player/form-player.tsx:315-350`. Depois de 25 saltos para o mesmo alvo, o salto é ignorado e o fluxo segue sequencial.
- **Teste:** `lib/logic-graph.test.ts:134-165` cobre A para B para A, salto para trás que fecha círculo pela sequência e salto para frente sem falso aviso.
- O contador não resetar durante a mesma resposta é coerente com a função de segurança. Resetá-lo ao voltar ou seguir sequencialmente permitiria que um ciclo contornasse o limite. O custo é que um fluxo intencional com mais de 25 retornos ao mesmo alvo será encerrado pela rota sequencial. Esse caso é atípico e o limite é suficientemente alto.
- **Ressalva:** a recuperação é silenciosa para o respondente e aparece apenas em `console.warn` (`form-player.tsx:334`). Isso não recria o aprisionamento infinito, mas uma mensagem amigável seria uma melhoria futura.

### 3. Layout intermediário: PARCIAL

- **Parte resolvida:** o painel direito é coluna estática somente em `xl` e vira drawer de 384 px entre `md` e `xl` (`components/form-builder/form-builder.tsx:2212-2218`). Assim, em 768-1279 px o preview deixa de dividir a largura com duas laterais permanentes (`form-builder.tsx:2089-2208`).
- **Z-index:** não há conflito confirmado. O drawer usa `z-40`, os diálogos usam `z-50` (`components/ui/dialog.tsx:41,63`) e a bottom nav também usa `z-50`, mas desaparece em `md` (`form-builder.tsx:2261-2262`).
- **Parte pendente:** `rightPanelHasContent` depende apenas da seleção/seção (`form-builder.tsx:362-368`), não da aba. A troca de aba apenas chama `setActiveTab` (`form-builder.tsx:964-971`) e preserva seleção/seção.
- **Reprodução:** em 1024 px, selecione uma pergunta, depois abra Integrações ou Compartilhar. O drawer da pergunta continua sobre a área da nova aba até ser fechado. Selecione Boas-vindas e depois Lógica: o editor de boas-vindas permanece sobre o mapa.
- O ErrorBoundary não torna o painel inacessível porque o comando de fechar fica fora dele (`form-builder.tsx:2219-2238`).
- A perda de foco é detalhada no novo achado N1.

### 4. Edição completa por teclado: ADIADO AUTORIZADO

O briefing excluiu este item do critério desta rodada. A dívida registrada na auditoria anterior permanece sem ser contabilizada como falha da implementação atual.

### 5. Modais altos: RESOLVIDO

- **Evidência:** os diálogos de Saltos, Conversões e evento terminal usam `max-h-[calc(100dvh-2rem)] overflow-y-auto` em `components/form-builder/logic-map.tsx:428`, `logic-map.tsx:449` e `logic-map.tsx:466`.
- O conteúdo deixa de crescer além da viewport e passa a ter rolagem interna. Cabeçalho e rodapé não são fixos, mas o defeito original de conteúdo inalcançável foi removido.

### 6. Remoção de opções no touch: PARCIAL

- **Parte resolvida:** os quatro controles usam `opacity-60` antes de `md` e só ficam dependentes de hover em desktop (`components/form-builder/form-preview.tsx:360-371`, `397-407`, `498-509`, `529-539`).
- **Parte pendente:** `p-2.5` em torno de ícones de 12-14 px produz caixa aproximada de 32-34 px, abaixo dos 44 px recomendados. `-m-2` muda ocupação externa, não aumenta a caixa clicável.
- Os botões têm apenas `title`, sem `aria-label`. Leitores de tela não recebem de forma confiável “Remover opção X”, que era parte da correção sugerida.
- **Reprodução:** em 390 px, o botão agora é visível. Inspecione sua caixa no DevTools: ela não alcança 44x44. No Accessibility Tree, não há nome específico da opção.

### 7. Exclusão de pergunta referenciada: PARCIAL

- **Parte resolvida:** o diálogo conta e avisa dependências de saltos/visibilidade (`components/form-builder/form-builder.tsx:870-888`, `form-builder.tsx:2462-2484`). `removeQuestionAndReferences` remove saltos cujo destino ou condição usa a pergunta e remove regras de visibilidade (`lib/question-integrity.ts:52-97`).
- A normalização é compatível: o helper devolve grupo canônico ou `undefined` (`question-integrity.ts:88-93`), o payload volta a normalizar e filtrar (`form-builder.tsx:495-505`), e o schema aceita regra legada ou grupo (`lib/schemas/form-schema.ts:45-66`, `123-133`).
- **Parte pendente:** eventos por conjunto vivem fora das perguntas, em `pixels.answerSetEvents` (`lib/database.types.ts:118-126`). `countQuestionReferences` e `removeQuestionAndReferences` recebem somente `QuestionConfig[]`, portanto não contam nem removem essas condições. `sanitizeAnswerSetEvents` elimina apenas condições com ID vazio, não IDs inexistentes (`lib/pixel-events.ts:224-246`).
- **Reprodução:** crie um evento por conjunto cuja condição leia a pergunta A. Exclua A. O diálogo não soma essa dependência; o evento continua em `pixels.answerSetEvents` e é salvo. O editor depois o mostra como órfão (`components/form-builder/answer-set-events-editor.tsx:46-90`). O player evita falso positivo ao exigir ID existente (`lib/pixel-events.ts:200-219`), mas a configuração órfã permanece.
- Os testes em `lib/question-integrity.test.ts:57-105` cobrem saltos e visibilidade, não eventos por conjunto.

### 8. Sincronização dos nós do mapa: RESOLVIDO

- **Evidência:** `components/form-builder/logic-map.tsx:251-261` mescla somente `data` fresco em cada nó e mantém as demais propriedades com `{ ...n }`.
- Não há ciclo de render: atualizar `rfNodes` rerenderiza o próprio mapa, mas não altera `questions` nem `formPixelEvents`, que são as entradas de `graph` (`logic-map.tsx:196-199`).
- Posição, viewport e campos internos como seleção são preservados no merge. O drag não pode ser perdido porque os nós são explicitamente `draggable: false` (`logic-map.tsx:230-240`). Mudança estrutural continua no efeito separado de ELK (`logic-map.tsx:208-249`).
- Falta um teste automatizado de edição não estrutural, mas o fluxo do estado está correto por inspeção.

### 9. Entrada da aba Lógica no mobile: ADIADO AUTORIZADO

O briefing excluiu este item do critério desta rodada. A dívida permanece documentada sem ser tratada como falha da correção atual.

### 10. Contraste e tamanho de texto: PARCIAL

- **Parte resolvida:** autosave usa `emerald-700` e `red-700` (`components/form-builder/form-builder.tsx:999-1009`); textos específicos do mapa e painel foram elevados para `slate-600`/variantes 700, por exemplo `logic-map.tsx:81-112`, `logic-map.tsx:348-350` e `right-panel.tsx:89-98`.
- **Parte pendente:** a busca atual no escopo `components/form-builder` ainda encontra 59 ocorrências de `text-[10px]`/`text-[11px]`, 58 de `text-slate-400` e 20 de variantes semânticas `red-500`/`blue-500`/`emerald-500`.
- Ocorrências relevantes permanecem nos fluxos principais: cabeçalhos e estados da lista (`form-builder.tsx:1178-1205`, `1260-1281`), instrução terminal do mapa (`logic-map.tsx:486`), dicas do editor de saltos (`branching-editor.tsx:161-162`, `224-225`), estado vazio de conversões (`pixel-branching-editor.tsx:178-180`) e erros/links de Compartilhar (`form-builder.tsx:2074-2082`).
- Portanto, os pontos críticos de autosave melhoraram, mas o achado sistêmico não foi encerrado.

### 11. Alvos de toque e semântica: PARCIAL

- **Parte resolvida:** boas-vindas, agradecimento e obrigatório associam `Label`/`Switch` por `htmlFor` e `id` (`components/form-builder/right-panel.tsx:89-98`, `190-199`, `376-390`). Os três acordeões expõem `aria-expanded` e `aria-controls` (`right-panel.tsx:344-359`, `420-435`, `447-462`). O fechamento global de Dialog mede 44x44 (`components/ui/dialog.tsx:69-76`).
- **Parte pendente:** switches de “Fechar formulário”, branding e notificações ainda não têm `id`, `htmlFor` ou `aria-label` (`components/form-builder/form-builder.tsx:1376-1401`, `1884-1909`). A primitiva Switch continua com caixa visual/clicável de 32x18 (`components/ui/switch.tsx:13-27`).
- Ações de lista seguem em 28x28 (`form-builder.tsx:221-249`), pontos do React Flow em 9-11 px (`logic-map.tsx:79`, `115-127`) e a correção de remoção de opções não alcança 44 px, como detalhado no item 6.

### 12. Autosave no mobile: RESOLVIDO

- **Evidência:** o status não usa mais `hidden sm:flex`; a região é visível em todas as larguras e usa `aria-live="polite"` (`components/form-builder/form-builder.tsx:999-1010`).
- Em menos de 640 px, “Salvando” reduz para o spinner, enquanto “Salvo” e “Erro ao salvar” continuam textuais e persistentes. O estado de erro não depende somente do toast.

### 13. Falha do ELK: PARCIAL

- **Parte resolvida:** a rejeição gera posições determinísticas em pilha vertical, respeitando a altura estimada de cada nó (`components/form-builder/logic-map.tsx:208-228`). Os nós não ficam mais todos em `(0,0)`.
- **Parte pendente:** não existe `layoutStatus`, skeleton inicial, aviso de falha nem botão “Tentar reorganizar”. A falha é totalmente silenciosa. Isso deixa sem resolver a metade “não possui estado de erro” do achado original.

### 14. Terminologia: PARCIAL

- **Parte resolvida:** chip da sidebar e mapa usam Salto/Saltos (`components/form-builder/form-builder.tsx:204-214`; `components/form-builder/logic-map.tsx:100-113`, `426-431`). Perguntas abertas também usam “Saltos” (`components/form-builder/branching-editor.tsx:110-113`).
- **Parte pendente:** blocos e perguntas de escolha ainda exibem o título “Ramificação” (`branching-editor.tsx:173-195`), além de instruções como “Use ramificação” e “definir a ramificação” (`branching-editor.tsx:198-206`).
- **Reprodução:** abra Lógica e Navegação de uma pergunta Sim/Não, dropdown ou checkbox. O cabeçalho principal ainda é “Ramificação”.

### 15. Overflow de URL e valores: RESOLVIDO

- **Evidência:** o link do diálogo de publicação usa `block break-all` (`components/form-builder/form-builder.tsx:2439-2442`). Valores das regras usam `min-w-0 break-words [overflow-wrap:anywhere]`, com ação `shrink-0` (`components/form-builder/branching-editor.tsx:228-237`; `components/form-builder/pixel-branching-editor.tsx:197-206`).

## Novos achados

### N1. [MÉDIO] Drawer intermediário preserva conteúdo fora de contexto e perde foco

- **Arquivo:linha:** `components/form-builder/form-builder.tsx:362-368`, `964-971`, `2218-2227`.
- **Problema de estado:** a condição de abertura não considera `activeTab`. Uma pergunta, boas-vindas ou agradecimento selecionado permanece como drawer sobre Lógica, Integrações ou Compartilhar.
- **Problema de foco:** ao abrir, nenhum foco é enviado para o drawer. Ao fechar, o próprio botão focado limpa seleção/seção e desmonta o painel, sem ref nem restauração para o elemento que o abriu. O foco volta ao documento, não ao item selecionado.
- **Reprodução:** em 1024 px, selecione Boas-vindas ou uma pergunta, mude para Compartilhar e observe o drawer residual. Navegue até “Fechar painel de propriedades”, ative com Enter e inspecione `document.activeElement`: o controle desmontou e nenhum gatilho recebe o foco.
- **Correção sugerida:** condicionar o drawer às abas que realmente usam propriedades; limpar ou suspender a seleção ao trocar para Integrações/Compartilhar; guardar o gatilho em ref, focar o cabeçalho/primeiro controle na abertura e devolver foco no fechamento.

### N2. [MÉDIO] Botão global de fechar Dialog pode cobrir títulos longos

- **Arquivo:linha:** `components/ui/dialog.tsx:62-76`; exemplos dinâmicos em `components/form-builder/logic-map.tsx:428-452`.
- **Problema:** o botão absoluto ocupa 44 px desde `top-1 right-1`, enquanto `DialogHeader` e `DialogTitle` não reservam padding à direita (`components/ui/dialog.tsx:83-115`). Com `p-6`, o botão invade 24 px da largura útil do conteúdo. Títulos longos podem renderizar sob o botão.
- **Escopo:** a primitiva é global, portanto afeta todos os Dialog que usam o fechamento padrão. O risco é imediatamente reproduzível nos títulos “Saltos de [título da pergunta]” e “Conversões de [título da pergunta]”.
- **Reprodução:** em 360 px, dê à pergunta um título longo e abra Saltos ou Conversões. A primeira linha ocupa a mesma região do botão de fechar.
- **Correção sugerida:** reservar `pr-10` ou `pr-12` no `DialogHeader`/`DialogTitle` quando `showCloseButton` estiver ativo, mantendo o alvo de 44 px.

## Validação executada

- `npx tsc --noEmit`: passou.
- `npx vitest run`: 75 arquivos e 944 testes passaram.
- `NODE_OPTIONS="--max-old-space-size=3072" npm run build`: passou.
- Avisos não regressivos do ambiente: múltiplos lockfiles, convenção `middleware` depreciada, uso de Edge Runtime impedindo geração estática de uma página e `ADMIN_ALERT_EMAIL` ausente.

## Prioridade recomendada

1. Completar a exclusão de pergunta limpando e contando `pixels.answerSetEvents`, com teste.
2. Corrigir estado e foco do drawer em `md` até `xl`.
3. Reservar espaço para o fechamento global dos diálogos.
4. Fechar os quick wins incompletos: alvo/nome dos botões de opção, switches restantes, contraste e terminologia.
5. Adicionar testes de integração para atualização não estrutural do mapa e comportamento do drawer.
