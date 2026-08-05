# Auditoria de UI/UX do Builder do EidosForm

**Data:** 2026-08-05  
**Escopo:** builder autenticado em `components/form-builder/`, com apoio de `lib/logic-graph.ts`, `lib/elk-layout.ts`, primitivas de UI utilizadas e o trecho de navegação do player que executa os saltos.  
**Método:** auditoria code-first, sem alteração funcional, deploy ou commit. Os breakpoints foram avaliados pelas restrições reais de largura das classes Tailwind. Os achados funcionais foram rastreados até o código que executa a regra no player.

## Sumário executivo

O builder tem bons mecanismos de proteção de salvamento e uma cobertura automatizada ampla, mas há sete riscos altos confirmados. O mais grave é funcional: duplicar uma pergunta preserva regras de salto ligadas ao ID antigo, o que pode publicar uma ramificação que avalia a resposta errada. O mapa também permite ciclos de salto que podem prender o respondente sem emitir alerta. Entre 768 e 1024 px, as duas barras laterais consomem quase toda a largura e tornam o preview impraticável. A edição principal de títulos, descrições e opções depende de elementos clicáveis sem semântica de teclado; no touch, excluir opções depende de hover. Os modais de lógica não têm limite de altura nem rolagem própria. No mobile, a aba Lógica não é alcançável pela navegação, embora os editores por pergunta cubram as funções centrais. Contraste, tipografia muito pequena, alvos de toque e feedback de autosave ainda precisam de uma passada sistêmica.

## Achados

### 1. [ALTO] Duplicar uma pergunta copia regras de salto ligadas ao ID original

- **Arquivo:linha:** `components/form-builder/form-builder.tsx:883`; `lib/form-logic-engine.ts:27`; `lib/branching.ts:48`.
- **Problema:** `duplicateQuestion` faz cópia rasa, troca somente `question.id` e mantém `jumpRules[].id` e `jumpRules[].condition.questionId`. O motor avalia a resposta por `answers[rule.questionId]`, portanto a cópia continua lendo a resposta da pergunta original. Como `getAnswerDestination` procura apenas pelo valor da opção, o editor pode mostrar a rota como configurada sem revelar que a regra está ligada ao ID antigo. IDs de regra duplicados também geram IDs de aresta duplicados no mapa (`jmp-${rule.id}`).
- **Como reproduzir:** crie uma pergunta Sim/Não, configure `Sim` para saltar, duplique a pergunta, publique e responda valores diferentes na original e na cópia. A rota da cópia é decidida pela resposta da original. No mapa, observe arestas com o mesmo ID lógico.
- **Correção sugerida:** fazer clone profundo; gerar novo ID para a pergunta e para cada regra; substituir `condition.questionId` pelo novo ID; regenerar também IDs internos de eventos copiados quando aplicável. Adicionar teste cobrindo duplicação seguida de `evaluateJumpRules`.

### 2. [ALTO] Ciclos de salto podem prender o respondente e o mapa não alerta

- **Arquivo:linha:** `lib/logic-graph.ts:232`; `components/form-player/form-player.tsx:307`.
- **Problema:** o diagnóstico do mapa verifica apenas se existe algum caminho até o fim. Como toda pergunta também tem uma aresta sequencial, uma pergunta pode passar nessa verificação mesmo quando uma regra ativa cria um ciclo. O player executa o salto e volta ao destino sem limite de visitas ou detecção de ciclo.
- **Como reproduzir:** configure a resposta `Sim` da pergunta 1 para ir à pergunta 2 e a resposta `Sim` da pergunta 2 para voltar à pergunta 1. Responda `Sim` nas duas. O player alterna entre elas indefinidamente e o mapa não registra erro.
- **Correção sugerida:** detectar componentes fortemente conectados nas arestas de salto e emitir aviso de ciclo potencial com os nomes das perguntas. Antes de publicar, bloquear ciclos incondicionais e pedir confirmação explícita para ciclos condicionais. Como defesa adicional, o player deve limitar revisitas consecutivas e exibir uma recuperação segura.

### 3. [ALTO] O layout de três painéis entra cedo demais e colapsa o preview em 768-1024 px

- **Arquivo:linha:** `components/form-builder/form-builder.tsx:1096`; `components/form-builder/form-builder.tsx:2083`; `components/form-builder/form-builder.tsx:2206`.
- **Problema:** a partir de `md` são exibidos simultaneamente sidebar de 320 px, preview e painel direito de 320 px; em `lg`, o painel direito cresce para 384 px. Em 1024 px restam 320 px para a coluna central. Depois de `md:p-8`, `FormPreview p-8` e o cartão `p-6`, o conteúdo útil da pergunta cai para aproximadamente 144 px. Em 768 px, as duas laterais somam 640 px antes de bordas e o preview praticamente zera.
- **Como reproduzir:** abra uma pergunta com opções nos viewports 768x900 e 1024x768. Compare com 1280 e 1440 px. Em 768-1024 px, o preview fica estreito, textos quebram e controles perdem a forma de formulário.
- **Correção sugerida:** reservar o modo de três painéis para `xl` (1280 px) ou maior. Entre 768 e 1279 px, usar dois painéis por vez, com o editor direito como drawer/sheet e um comando explícito para alternar sidebar e preview. Trocar os atuais `md:flex`/`md:w-*` estruturais por `xl:flex`/`xl:w-*`; manter paddings menores antes de `xl`.

### 4. [ALTO] O fluxo principal de selecionar e editar perguntas não funciona por teclado

- **Arquivo:linha:** `components/form-builder/form-builder.tsx:167`; `components/form-builder/form-builder.tsx:180`; `components/form-builder/form-preview.tsx:89`; `components/form-builder/form-preview.tsx:139`.
- **Problema:** o item da lista é um `motion.div` com `onClick`, sem `button`, `tabIndex`, `role` ou tratamento de Enter/Espaço. O drag handle também é um `div` somente com `onPointerDown`. No preview, `InlineEditableText` usa outro `div` clicável. Título, descrição, placeholder e opções são editados exclusivamente por esse caminho inline; o painel direito não oferece campos alternativos para esse conteúdo. Um usuário de teclado consegue alcançar duplicar/excluir, mas não selecionar nem abrir a edição principal.
- **Como reproduzir:** recarregue o builder, use apenas Tab, Shift+Tab, Enter e Espaço. Tente selecionar uma pergunta da sidebar e editar o título no preview. Nenhum dos dois controles entra na ordem de foco.
- **Correção sugerida:** transformar a ação de seleção em botão real e separar o handle de reordenação. Para o texto inline, usar botão com nome acessível que, ao ativar, troca para input/textarea e devolve o foco ao gatilho ao salvar/cancelar. Implementar reordenação por teclado com comandos "Mover para cima/baixo" ou uma lista sortable acessível.

### 5. [ALTO] Modais de lógica podem ultrapassar a viewport sem área rolável

- **Arquivo:linha:** `components/form-builder/logic-map.tsx:404`; `components/form-builder/logic-map.tsx:425`; `components/form-builder/logic-map.tsx:442`; `components/ui/dialog.tsx:63`.
- **Problema:** os três `DialogContent` do mapa limitam apenas a largura. A primitiva comum também não define `max-height` ou `overflow-y`. Branching e conversões crescem conforme opções e regras; em telas baixas, zoom alto ou com teclado virtual, conteúdo e botão de fechar podem ficar fora da viewport.
- **Como reproduzir:** em 768x600, abra "Saltos" numa pergunta com oito ou mais opções, ou adicione várias regras a uma pergunta aberta. Reduza a altura ou abra o teclado virtual. O diálogo cresce além da área visível e não cria rolagem interna confiável.
- **Correção sugerida:** aplicar `max-h-[calc(100dvh-2rem)] overflow-hidden` no conteúdo e envolver a região editável em `min-h-0 overflow-y-auto overscroll-contain`. Manter cabeçalho e fechamento fixos. Para esses três casos, `overflow-y-auto` direto no `DialogContent` já é um primeiro reparo seguro.

### 6. [ALTO] Excluir opções no preview depende de hover e fica oculto no touch

- **Arquivo:linha:** `components/form-builder/form-preview.tsx:360`; `components/form-builder/form-preview.tsx:397`; `components/form-builder/form-preview.tsx:498`; `components/form-builder/form-preview.tsx:529`.
- **Problema:** os botões de remover opção começam com `opacity-0` e só aparecem em `group-hover`. Em celular não há hover persistente confiável. Além disso, o alvo visual tem apenas ícone de 12-14 px com `p-0.5`. Como o painel direito não possui editor alternativo das opções, a ação existe mas é praticamente invisível para o público mobile.
- **Como reproduzir:** em 360 ou 390 px, selecione uma pergunta de escolha e tente descobrir como excluir uma opção sem mouse. O controle não aparece até uma interação de hover emulada pelo navegador e o alvo continua muito pequeno.
- **Correção sugerida:** usar `opacity-70 md:opacity-0 md:group-hover:opacity-70 focus-visible:opacity-100`; dar `min-h-11 min-w-11` ao botão; manter o ícone pequeno dentro da área maior; fornecer `aria-label="Remover opção X"`.

### 7. [ALTO] Excluir pergunta não trata dependências de lógica e permite publicar referências órfãs

- **Arquivo:linha:** `components/form-builder/form-builder.tsx:873`; `components/form-builder/form-builder.tsx:480`; `lib/logic-graph.ts:155`; `lib/logic-graph.ts:192`.
- **Problema:** a confirmação remove apenas a pergunta selecionada. Regras de salto, condições de exibição e eventos de conjunto que a referenciam permanecem. O payload filtra regra de salto sem destino, mas não verifica se o destino ainda existe. O mapa consegue alertar depois, porém o diálogo de exclusão não informa o impacto e a publicação não é bloqueada.
- **Como reproduzir:** faça a pergunta 1 saltar para a 3 ou use a 1 como condição de exibição da 2. Exclua a pergunta referenciada e publique sem abrir o mapa. A configuração órfã é salva; no player, o salto cai no sequencial ou a condição passa a avaliar resposta inexistente.
- **Correção sugerida:** antes de excluir, calcular dependências e mostrar "Esta pergunta é usada em N regras". Oferecer cancelar, remover dependências junto ou escolher substituta. Bloquear publicação enquanto houver referências órfãs e levar o usuário diretamente ao primeiro erro.

### 8. [MÉDIO] O mapa mantém dados visuais antigos após mudanças não estruturais

- **Arquivo:linha:** `components/form-builder/logic-map.tsx:196`; `components/form-builder/logic-map.tsx:201`; `components/form-builder/logic-map.tsx:219`.
- **Problema:** `graph` muda quando condição, título, pixel ou aviso muda, mas `rfNodes` só é sincronizado quando `structureKey` ou `elkPos` muda. `structureKey` contém IDs, destinos e handles, não o conteúdo dos nós. Assim, evento de pixel, condição de exibição, nome e cor de aviso podem continuar antigos no cartão até ocorrer uma mudança de topologia ou remontagem da aba. As arestas atualizam separadamente, o que deixa mapa e painel em desacordo.
- **Como reproduzir:** na aba Lógica, edite uma conversão de pixel, condição de exibição ou evento do nó Início/Fim sem criar/remover aresta. Feche o editor. O painel contém o valor novo, mas o selo ou estado do nó não acompanha imediatamente.
- **Correção sugerida:** separar layout de conteúdo. Um efeito deve recalcular posições somente com `structureKey`; outro deve fazer `setRfNodes` mesclando `data` sempre que `graph.nodes` mudar, preservando `position`, seleção e viewport. Adicionar teste de atualização sem mudança topológica.

### 9. [MÉDIO] A aba Lógica não é alcançável abaixo de 768 px

- **Arquivo:linha:** `components/form-builder/form-builder.tsx:948`; `components/form-builder/form-builder.tsx:1099`; `components/form-builder/form-builder.tsx:2239`; `components/form-builder/question-editor.tsx:34`.
- **Problema:** o comando Lógica existe apenas no nav `hidden md:flex`. O seletor mobile oferece Editar, Integrações e Compartilhar; a bottom nav oferece Perguntas, Editar e Preview. Portanto um usuário que entra no builder em 360 ou 390 px não consegue abrir o mapa. O caminho alternativo por pergunta é funcional: `QuestionEditor onlyLogic` inclui ramificação, visibilidade e conversões, mas está escondido dentro do acordeão "Lógica e Navegação" e não comunica equivalência com a aba desktop.
- **Como reproduzir:** abra diretamente em 360 ou 390 px e percorra todos os comandos visíveis. Não há entrada para Lógica. Em seguida selecione uma pergunta e abra "Lógica e Navegação" para encontrar o caminho alternativo.
- **Correção sugerida:** adicionar "Lógica" ao seletor mobile, mas não forçar o canvas em 360 px. Mostrar uma lista mobile de perguntas com alertas e ações "Editar saltos", "Condição" e "Conversões", reutilizando os editores existentes em sheet de tela cheia. Documentar que esse caminho cobre 100% da lógica por pergunta.

### 10. [MÉDIO] Texto auxiliar e estados semânticos falham contraste AA

- **Arquivo:linha:** `components/form-builder/form-builder.tsx:993`; `components/form-builder/form-builder.tsx:1171`; `components/form-builder/logic-map.tsx:81`; `components/form-builder/logic-map.tsx:325`; `components/form-builder/right-panel.tsx:92`.
- **Problema:** há 59 ocorrências de `text-[10px]`/`text-[11px]` e 61 de `text-slate-400` no escopo auditado. Pelos tokens do Tailwind v4 usados no projeto, `slate-400` tem contraste aproximado de 2,63:1 sobre branco e 2,51:1 sobre `slate-50`. Também falham em texto normal: `red-500` 3,82:1, `blue-500` 3,76:1 e `emerald-500` 2,46:1 sobre branco. Isso atinge o indicador "Salvo", labels do mapa, instruções e mensagens de erro.
- **Como reproduzir:** inspecione os elementos citados sobre fundo branco/slate-50 e calcule contraste a partir dos tokens `oklch` de `node_modules/tailwindcss/theme.css`. Compare com 4,5:1 para texto normal.
- **Correção sugerida:** usar pelo menos `text-slate-600` para ajuda pequena, `text-red-700`, `text-blue-700`, `text-emerald-700` e `text-amber-700` para texto semântico. Reservar `slate-400/500` para ícone decorativo grande ou elemento desabilitado. Elevar ajuda recorrente a `text-xs`/12 px no mínimo e preferir 13-14 px para instruções do público 40+.

### 11. [MÉDIO] Alvos de toque e nomes acessíveis são inconsistentes

- **Arquivo:linha:** `components/ui/button.tsx:23`; `components/ui/switch.tsx:16`; `components/ui/dialog.tsx:69`; `components/form-builder/form-builder.tsx:221`; `components/form-builder/branching-editor.tsx:123`; `components/form-builder/logic-map.tsx:79`; `components/form-builder/right-panel.tsx:89`.
- **Problema:** o tamanho global `sm` tem 32 px; switches medem 32x18 px; o fechamento de Dialog é essencialmente um ícone de 16 px sem padding; ações de lista usam 28x28 ou 24x24; handles do React Flow têm 9-11 px. Vários switches são renderizados ao lado de `Label` sem `htmlFor`, `id` ou `aria-label`, ficando sem nome confiável para leitor de tela. Os acordeões também não expõem `aria-expanded`/`aria-controls`.
- **Como reproduzir:** em 390 px, ative a visualização de caixas de acessibilidade ou tente tocar nos controles citados com o polegar. Com leitor de tela, percorra os switches de boas-vindas, agradecimento, obrigatório e configurações; alguns são anunciados apenas como "switch".
- **Correção sugerida:** preservar ícones pequenos, mas envolver ações em `min-h-11 min-w-11`; aumentar a área invisível dos handles sem engrossar o ponto visual; associar cada `Label` a um `id` ou fornecer `aria-label`; adicionar estados ARIA aos acordeões. Para desktop denso, o alvo pode sobrepor área vazia sem aumentar a altura visual de todas as linhas.

### 12. [MÉDIO] Mobile esconde todo o feedback persistente do autosave

- **Arquivo:linha:** `components/form-builder/form-builder.tsx:992`; `components/form-builder/form-builder.tsx:1000`; `components/form-builder/form-builder.tsx:2239`.
- **Problema:** o único indicador persistente de `saving`, `saved` e `error` usa `hidden sm:flex`. Em 360 e 390 px, o usuário não vê se a edição está sendo salva. Erros geram toast, mas depois que ele some não há estado persistente nem aviso junto à bottom nav. Para um editor sem botão Salvar, isso reduz confiança e facilita saída com alteração pendente.
- **Como reproduzir:** em viewport menor que 640 px, altere um título e observe o header. Repita com a rede offline. Não aparece "Salvando", "Salvo" ou "Erro ao salvar" no layout fixo.
- **Correção sugerida:** manter um indicador compacto no mobile, por exemplo ícone + ponto com texto acessível e `aria-live="polite"`; quando houver erro, exibir faixa persistente com "Tentar novamente". Não depender apenas de cor ou toast.

### 13. [MÉDIO] Falha do ELK deixa nós sobrepostos e não possui estado de erro

- **Arquivo:linha:** `components/form-builder/logic-map.tsx:209`; `components/form-builder/logic-map.tsx:224`.
- **Problema:** a rejeição de `elkLayout` é ignorada. Antes do layout, todos os nós recebem posição `{x: 0, y: 0}`; se o ELK falhar, o mapa fica com cartões empilhados no mesmo ponto, sem mensagem, retry ou fallback. Também não há estado de loading explícito durante o primeiro cálculo.
- **Como reproduzir:** force `elkLayout` a rejeitar em teste ou simule falha do worker/módulo. Abra um formulário com várias perguntas. O canvas renderiza nós sobrepostos e o usuário não recebe explicação.
- **Correção sugerida:** controlar `layoutStatus: loading | ready | error`; em erro, aplicar fallback vertical determinístico (`x: 0`, `y: index * gap`), mostrar aviso e botão "Tentar reorganizar". Durante o cálculo inicial, exibir skeleton simples no canvas.

### 14. [BAIXO] A mesma função recebe quatro nomes no fluxo

- **Arquivo:linha:** `components/form-builder/form-builder.tsx:207`; `components/form-builder/right-panel.tsx:423`; `components/form-builder/branching-editor.tsx:112`; `components/form-builder/logic-map.tsx:105`.
- **Problema:** a sidebar fala em "caminho", o painel usa "Lógica e Navegação", o editor usa "Ramificação" e o mapa usa "Salto". Para usuário leigo, parece que são recursos diferentes, principalmente ao alternar desktop e mobile.
- **Como reproduzir:** crie uma regra de rota e percorra sidebar, painel direito, mapa e modal. Compare os títulos e botões.
- **Correção sugerida:** escolher um termo principal. Sugestão: "Desvio de caminho" como conceito, com ação curta "Adicionar desvio"; manter "Lógica" como nome da área. Se "Salto" já é linguagem validada com clientes, usar "Salto" em todos os pontos e retirar "Ramificação" da UI.

### 15. [BAIXO] URL longa pode escapar do diálogo de publicação

- **Arquivo:linha:** `components/form-builder/form-builder.tsx:2417`; `components/form-builder/branching-editor.tsx:232`; `components/form-builder/pixel-branching-editor.tsx:201`.
- **Problema:** o link no diálogo de publicação não usa `break-all`/`overflow-wrap:anywhere`, ao contrário da área Compartilhar. Valores longos das regras avançadas também ficam em `span` flex sem `min-w-0` e sem quebra. Slugs ou valores longos podem sair do cartão ou empurrar o botão de remoção.
- **Como reproduzir:** use slug próximo do limite ou valor de condição contendo URL/token longo. Abra o diálogo Publicar ou a seção de regra avançada em 360 px.
- **Correção sugerida:** adicionar `block break-all` ao `code`; nos spans de regra, usar `min-w-0 break-words [overflow-wrap:anywhere]` e manter a ação `shrink-0`.

## Quick wins, menos de 15 minutos cada

- Exibir no mobile ao menos o estado compacto de autosave, removendo a ocultação total de `form-builder.tsx:993`.
- Aplicar `max-h-[calc(100dvh-2rem)] overflow-y-auto` aos três diálogos do mapa como proteção imediata.
- Tornar os botões de excluir opção visíveis antes de `md` e adicionar `aria-label` com o nome da opção.
- Adicionar `break-all` ao link do diálogo de publicação.
- Trocar textos de estado `red-500`, `blue-500` e `emerald-500` por variantes `700`; trocar ajuda pequena `slate-400` por `slate-600` nos fluxos principais.
- Associar `id`/`htmlFor` ou `aria-label` aos switches de boas-vindas, agradecimento, obrigatório e notificações.
- Adicionar `aria-expanded` e `aria-controls` aos três cabeçalhos recolhíveis do painel direito.
- Aumentar o alvo do botão de fechar de Dialog para 44x44 px sem aumentar o ícone.

## Ordem recomendada de correção

1. Integridade da lógica: duplicação, ciclos e dependências ao excluir.
2. Layout de 768-1024 px e modais com altura limitada.
3. Caminho completo por teclado e ações touch visíveis.
4. Sincronização do mapa e entrada mobile para Lógica.
5. Contraste, tipografia, alvos e linguagem consistente.

## Validação executada

- `npx tsc --noEmit`: passou.
- `npx vitest run`: 74 arquivos e 932 testes passaram.
- `NODE_OPTIONS="--max-old-space-size=3072" npm run build`: passou.
- O build emitiu avisos já existentes e fora do escopo do builder: múltiplos lockfiles, convenção `middleware` depreciada e `ADMIN_ALERT_EMAIL` ausente no ambiente de build.

Os testes atuais não cobrem duplicação de pergunta com lógica, detecção de ciclos, atualização visual não estrutural do mapa, breakpoints intermediários ou navegação por teclado. Nenhum arquivo funcional foi alterado.
