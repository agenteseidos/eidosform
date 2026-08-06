# Auditoria geral do Builder do EidosForm após as correções

**Data:** 2026-08-05  
**Commit auditado:** `83fb9f3e9d6c23ed1857bbb12d88fdf3dabc59d8`  
**Referências:** `docs/auditoria-ui-builder-2026-08-05.md` e `docs/auditoria-verificacao-builder-2026-08-05.md`  
**Escopo:** fluxo completo do builder autenticado, incluindo edição, lógica, preview, integrações, compartilhamento, responsividade, integridade dos dados, acessibilidade, estados de erro e primitivas compartilhadas usadas pelo builder.  
**Método:** revisão code-first do estado atual e do diff do commit, rastreamento dos fluxos até helpers e player, inspeção das restrições responsivas e execução integral de TypeScript, testes e build de produção. O deploy informado como READY não foi revalidado por navegação no ambiente publicado. O worktree estava limpo no início. Alterações concorrentes surgidas depois da validação não fazem parte deste veredito, que permanece fixado no commit acima.

## Conclusão executiva

O lote pode permanecer em produção e não há evidência de regressão funcional crítica ou alta que justifique rollback. As correções de maior risco estão consistentes, incluindo duplicação profunda, proteção contra ciclos, limpeza de dependências ao excluir perguntas, sincronização do mapa e autosave no mobile.

Entretanto, o estado atual não sustenta a afirmação de que todos os pendentes foram encerrados. Dos 15 achados originais:

- **9 estão resolvidos**;
- **4 continuam parciais**;
- **2 permanecem adiados com autorização**.

O principal reparo desta rodada, a limpeza de `pixels.answerSetEvents`, está correto e coberto por quatro testes. As duas regressões da verificação anterior melhoraram, mas o gerenciamento de foco do drawer ainda é parcial. O fechamento global de Dialog foi corrigido adequadamente.

Os resíduos confirmados concentram-se em quatro áreas:

1. um dos quatro controles de remoção de opção não recebeu a correção de 44 px nem o `aria-label`;
2. o drawer pode restaurar foco para um elemento antigo ao trocar de aba e não reage a mudança de breakpoint;
3. ações destrutivas dos editores de lógica ainda têm alvos de 20 a 24 px e algumas não possuem nome acessível;
4. contraste e texto auxiliar melhoraram em pontos escolhidos, mas não receberam a passada sistêmica prometida.

**Veredito:** **APROVADO COM RESSALVAS**. Funcionalmente seguro para continuar no ar, mas a auditoria não deve ser marcada como 100% encerrada.

## Placar da auditoria original

| Item | Veredito atual | Evidência resumida |
|---|---|---|
| 1. Duplicação e regras de salto | **RESOLVIDO** | Clone profundo, IDs novos e condição própria re-apontada |
| 2. Ciclos de salto | **RESOLVIDO** | Diagnóstico no mapa, testes e limite defensivo no player |
| 3. Layout de 768 a 1279 px | **PARCIAL** | Estrutura de dois painéis funciona; ciclo de foco do drawer ainda falha em transições |
| 4. Edição por teclado | **ADIADO AUTORIZADO** | Dívida conhecida e ainda reproduzível |
| 5. Altura dos modais | **RESOLVIDO** | Limite por viewport e rolagem interna nos diálogos de lógica |
| 6. Exclusão de opções no touch | **PARCIAL** | Três controles completos; o controle de opção normal do tipo `select` ficou antigo |
| 7. Exclusão de pergunta referenciada | **RESOLVIDO** | Agora inclui saltos, visibilidade e eventos por conjunto de respostas |
| 8. Dados antigos no mapa | **RESOLVIDO** | Dados são mesclados sem recalcular posição nem perder viewport |
| 9. Entrada da Lógica no mobile | **ADIADO AUTORIZADO** | Dívida conhecida e documentada |
| 10. Contraste e texto auxiliar | **PARCIAL** | Alguns pontos subiram para `slate-600`; ainda há textos funcionais abaixo de AA |
| 11. Alvos e nomes acessíveis | **PARCIAL** | Switches citados foram nomeados; várias ações pequenas continuam pendentes |
| 12. Autosave mobile | **RESOLVIDO** | Estado persistente e região `aria-live` em todas as larguras |
| 13. Falha do ELK | **RESOLVIDO** | Fallback, aviso âmbar e retry visíveis |
| 14. Terminologia | **RESOLVIDO** | Não há ocorrência visível de “Ramificação”; comentários internos não afetam a UI |
| 15. Overflow de URL e regras | **RESOLVIDO** | Quebra explícita e contenção aplicadas nos pontos auditados |

## Correções confirmadas

### 1. Eventos por conjunto de respostas na exclusão: RESOLVIDO

- **Evidência:** `lib/question-integrity.ts:100-129`; `components/form-builder/form-builder.tsx:894-914`; `lib/question-integrity.test.ts:108-146`.
- `countAnswerSetReferences` soma todas as condições que leem a pergunta excluída.
- `removeAnswerSetReferences` remove a condição órfã, elimina o evento que fica sem condições e limita `minMatches` ao novo total.
- O diálogo soma essas condições às demais dependências e informa que serão removidas junto.
- O estado de pixels é atualizado pela forma funcional de `setPixels`, evitando leitura antiga desse objeto no momento da confirmação.
- Os quatro cenários específicos passaram na suíte: contagem, remoção de condição, remoção de evento vazio e reajuste de `minMatches`.

Não foi encontrada lacuna adicional nesse fluxo.

### 2. Drawer condicionado à aba: PARTE VISUAL RESOLVIDA

- **Evidência:** `components/form-builder/form-builder.tsx:362-373`; `form-builder.tsx:2242-2248`.
- O drawer agora só aparece quando existe conteúdo selecionado e a aba ativa usa propriedades.
- Em Integrações e Compartilhar ele deixa de cobrir conteúdo fora de contexto.
- A seleção permanece preservada para reabrir o editor ao voltar, conforme a decisão descrita no commit.
- O modo de três colunas continua reservado a `xl`, preservando largura útil no intervalo de 768 a 1279 px.

O estado visual foi corrigido. A ressalva de foco é detalhada no achado A2.

### 3. Fechamento global de Dialog: RESOLVIDO

- **Evidência:** `components/ui/dialog.tsx:63-89`.
- O botão mantém área de 44 por 44 px.
- `DialogHeader` recebeu `pr-8`. Considerando o `p-6` do conteúdo e o botão absoluto em `right-1`, o título termina com cerca de 8 px de folga antes da área do fechamento.
- Títulos longos podem quebrar linha sem renderizar sob o botão.

O padding também é aplicado quando um diálogo opta por esconder o fechamento, mas isso é apenas espaço excedente e não constitui defeito funcional.

### 4. Falha do layout ELK: RESOLVIDO NO FLUXO DE ERRO

- **Evidência:** `components/form-builder/logic-map.tsx:210-231`; `logic-map.tsx:356-366`.
- Uma rejeição cria layout vertical determinístico, em vez de empilhar nós em `(0,0)`.
- A interface exibe faixa âmbar com explicação e ação “Tentar reorganizar”.
- Um retry bem-sucedido remove o estado de erro.

Resta uma melhoria baixa: após o fallback já ter acionado o primeiro `fitView`, o retry não zera `hasFittedRef`. Assim, novas posições do ELK não são reenquadradas automaticamente. Isso não impede o retry, mas pode exigir zoom ou pan manual.

### 5. Terminologia, contraste pontual e switches: CORREÇÕES CONFIRMADAS

- A busca case-insensitive por “Ramificação” encontrou somente comentários de implementação em `branching-editor.tsx`; a UI usa “Saltos”.
- Cabeçalhos de seção e dicas escolhidas no commit foram elevados para `slate-600`.
- Os switches de fechar formulário, ocultar branding e as duas notificações por e-mail agora possuem `aria-label` em `form-builder.tsx:1407-1429` e `form-builder.tsx:1917-1939`.
- Boas-vindas, agradecimento e obrigatório continuam associados por `id` e `htmlFor` no painel direito.
- O switch de WhatsApp também possui nome, embora o texto acessível esteja em inglês enquanto a interface está em português. É uma inconsistência pequena, não ausência de nome.

## Achados ainda abertos

### A1. [MÉDIO] Uma variação de remoção de opção ficou fora da correção

- **Arquivo:linha:** `components/form-builder/form-preview.tsx:500-511`.
- **Problema:** o botão de remover uma opção normal do tipo `select` ainda usa `p-2.5 -m-2`, com ícone de 14 px. A caixa interativa fica em aproximadamente 34 por 34 px. A margem negativa altera a ocupação externa, não amplia o hitbox.
- O botão possui apenas `title="Remover opção"`; não recebeu o `aria-label` aplicado às outras três variações e não identifica qual opção será removida.
- **Comparação:** as variações em `form-preview.tsx:360-372`, `399-409` e `532-542` usam `h-11 w-11` e `aria-label`.
- **Reprodução:** crie uma pergunta do tipo Select com duas opções, abra o editor em 390 px e inspecione o botão de remover de uma opção normal.
- **Correção recomendada:** aplicar o mesmo padrão `flex h-11 w-11 -m-3 ...` e `aria-label="Remover opção [nome]"` aos quatro caminhos, preferencialmente extraindo um componente único para impedir nova divergência.

Este achado mantém o item 6 como parcial e contradiz especificamente a afirmação de que todos os botões de opção receberam alvo de 44 px e `aria-label`.

### A2. [MÉDIO] O ciclo de foco do drawer continua incompleto

- **Arquivo:linha:** `components/form-builder/form-builder.tsx:375-392`; navegação em `form-builder.tsx:982-1010`; drawer em `form-builder.tsx:2248-2258`.
- **Troca de aba:** ao clicar em Integrações ou Compartilhar com o drawer aberto, o próprio botão da aba recebe foco. A alteração torna `rightPanelHasContent` falso e o efeito restaura imediatamente o foco para `drawerTriggerRef`, afastando-o da aba recém-ativada.
- **Gatilho não focável:** a pergunta da sidebar que abre o painel é um `motion.div` com `onClick`, não um controle focável (`form-builder.tsx:169-183`). Em abertura por mouse, `document.activeElement` pode ser um controle anterior ou o corpo do documento. Portanto, o ref não representa necessariamente a pergunta que abriu o drawer.
- **Mudança de breakpoint:** o efeito depende apenas de `rightPanelHasContent`. Redimensionar de `xl` para o intervalo do drawer, ou no sentido inverso, não executa novamente a transferência de foco enquanto o booleano permanecer igual.
- **Alvo do fechamento:** o botão local mede 40 por 40 px (`h-10 w-10`), abaixo do padrão de 44 px usado no Dialog.
- **Correção recomendada:** diferenciar fechamento explícito de ocultação por troca de contexto; passar o gatilho real no momento da seleção; observar a media query com listener; mover foco apenas quando o modo drawer efetivamente abre; restaurar somente no fechamento explícito e se o alvo ainda estiver válido.

O conteúdo fora de contexto foi resolvido, mas o item 3 e a regressão N1 anterior permanecem parciais por causa do foco.

### A3. [MÉDIO] Ações destrutivas dos editores de lógica continuam pequenas e sem nome

- **Arquivos:** `components/form-builder/branching-editor.tsx:123-126`, `branching-editor.tsx:234-237`, `pixel-branching-editor.tsx:109-112`, `pixel-branching-editor.tsx:203-206`, `answer-set-events-editor.tsx:83-85`.
- Esses botões medem entre 20 e 24 px, possuem apenas um ícone `X` e não têm texto, `aria-label` nem `title`.
- Na lista principal, duplicar e excluir perguntas possuem nome acessível, mas continuam com 28 por 28 px (`form-builder.tsx:223-249`).
- O botão “Tentar reorganizar” mede 28 px de altura e o fechamento do drawer mede 40 px.
- O componente global `Switch` continua visual e interativamente pequeno, embora os usos do builder agora estejam nomeados.
- **Impacto:** risco de toque errado em operações destrutivas e controles anunciados sem finalidade por leitor de tela.
- **Correção recomendada:** adotar área mínima de 44 por 44 px para ações touch, mantendo o ícone visual pequeno; nomear cada ação com o contexto, por exemplo “Excluir condição 2” e “Excluir regra de salto 1”.

O commit resolveu os switches citados e três botões de opção, mas não encerrou o achado sistêmico 11.

### A4. [MÉDIO] Contraste e tipografia ainda não receberam correção sistêmica

A busca estática atual em `components/form-builder` encontra:

- 59 ocorrências de `text-[10px]` ou `text-[11px]`;
- 48 ocorrências de `text-slate-400`;
- 19 ocorrências de `text-red-500`, `text-blue-500` ou `text-emerald-500`.

Nem toda ocorrência é um defeito, pois o conjunto inclui ícones decorativos, placeholders, badges e estados desabilitados. Ainda assim, permanecem usos funcionais relevantes:

- estados de boas-vindas e agradecimento e estado vazio da lista em `form-builder.tsx:1225`, `1248` e `1307` usam `slate-400`;
- ajuda do editor de saltos em `branching-editor.tsx:224-225` usa 11 px com `slate-400`;
- mensagem de erro de slug em `form-builder.tsx:2111` e exclusão de evento em `answer-set-events-editor.tsx:149-151` usam `red-500` em texto pequeno;
- links de upgrade e diversas ajudas de configuração ainda usam `blue-500` ou `slate-400`;
- a bottom navigation usa `slate-400` no estado inativo e `#F5B731` no ativo (`form-builder.tsx:2293-2320`). O amarelo ativo tem contraste aproximado de **1,79:1** sobre branco, abaixo de 4,5:1 para texto normal.

- **Impacto:** leitura fraca em mobile, luz forte, telas de menor qualidade e para o público com baixa visão.
- **Correção recomendada:** criar uma regra de tokens, não uma troca pontual. Texto auxiliar deve usar no mínimo `slate-600`; texto semântico pequeno deve usar variantes 700; o amarelo da marca deve aparecer como fundo, borda ou indicador acompanhado de texto escuro, não como texto pequeno sobre branco.

O commit melhorou os pontos explicitamente escolhidos, mas o item 10 permanece parcial.

## Dívidas adiadas e ainda reproduzíveis

### D1. [ALTO, ADIADO] Edição principal por teclado

- **Evidência:** a pergunta da sidebar continua em `motion.div onClick` (`form-builder.tsx:169-183`) e o texto inline continua em `div onClick` (`form-preview.tsx:89-103`).
- Esses elementos não possuem papel interativo, `tabIndex` nem tratamento de Enter ou Espaço.
- O drag handle permanece exclusivamente por ponteiro.
- O adiamento foi autorizado, portanto não é regressão do commit. A severidade original continua válida para acessibilidade completa.

### D2. [MÉDIO, ADIADO] Entrada completa da Lógica no mobile

- **Evidência:** a entrada Lógica segue no nav `hidden md:flex` (`form-builder.tsx:982-1011`) e a bottom navigation mobile oferece somente Perguntas, Editar e Preview (`form-builder.tsx:2292-2321`).
- Os editores por pergunta continuam oferecendo parte importante da lógica, mas não há uma entrada mobile equivalente e explícita para o mapa.
- O adiamento foi autorizado e está documentado, mas o requisito continua aberto.

## Revisão por dimensão

### Integridade funcional

- Duplicação profunda: aprovada.
- Detecção e contenção de ciclos: aprovada.
- Exclusão de referências em perguntas: aprovada.
- Exclusão de referências em `answerSetEvents`: aprovada.
- Sincronização não estrutural do mapa: aprovada por inspeção.
- Nenhuma referência órfã nova foi encontrada nos fluxos corrigidos.

### Responsividade

- Mobile abaixo de 768 px: estrutura principal preservada, autosave visível e editor em tela cheia.
- Intervalo de 768 a 1279 px: preview recuperou largura útil; painel direito opera como drawer.
- Desktop a partir de 1280 px: três colunas estáticas continuam disponíveis.
- Pendências: foco do drawer e ausência autorizada da entrada de Lógica no mobile.

### Acessibilidade

- Melhorias confirmadas: fechamento de Dialog com 44 px, switches nomeados, acordeões com estado ARIA, autosave com `aria-live` e três remoções de opção com 44 px.
- Pendências: edição por teclado, ações destrutivas pequenas e sem nome, um botão de opção divergente e contraste da navegação mobile.

### Consistência e feedback

- Terminologia “Saltos” está consistente na interface.
- Falha do ELK deixou de ser silenciosa.
- Erros e estados de salvamento principais estão visíveis.
- A hierarquia continua coerente com um SaaS de edição densa; os problemas restantes são de aplicação incompleta dos tokens e padrões de interação, não de necessidade de redesign total.

## Priorização recomendada

### P1, fechar antes de declarar a auditoria concluída

1. Corrigir a quarta variação do botão de remover opção.
2. Refazer o ciclo de foco do drawer e elevar seu fechamento para 44 px.
3. Nomear e ampliar as ações destrutivas dos editores de Saltos, Conversões e eventos por conjunto.

### P2, passada sistêmica curta

4. Corrigir a bottom navigation, textos auxiliares funcionais e cores semânticas pequenas por meio de tokens consistentes.
5. Fazer o retry do ELK reenquadrar o mapa quando as posições forem recalculadas.
6. Adicionar testes de interação para drawer, remoção de opções e nomes acessíveis. A suíte atual não contém testes para esses comportamentos.

### Backlog autorizado

7. Implementar edição e reordenação completas por teclado.
8. Criar entrada mobile completa para a Lógica.

## Validação executada

- `npx tsc --noEmit`: passou sem erros.
- `npx vitest run`: **75 arquivos e 948 testes passaram**.
- `NODE_OPTIONS="--max-old-space-size=3072" npm run build`: passou.
- O build confirmou a rota dinâmica `/forms/[id]/builder` e concluiu a geração das 57 páginas estáticas.
- Avisos não regressivos e fora do escopo funcional desta auditoria: múltiplos lockfiles, convenção `middleware` depreciada, Edge Runtime impedindo geração estática de uma página e `ADMIN_ALERT_EMAIL` ausente no ambiente de build.

## Encerramento

O commit `83fb9f3` resolve a lacuna funcional mais importante da verificação anterior e mantém a aplicação tecnicamente saudável. A suíte, o TypeScript e o build sustentam essa conclusão. O lote, porém, ainda deixa quatro achados parciais e duas dívidas autorizadas. A descrição correta do estado é: **correções funcionais principais concluídas, com acabamento de acessibilidade e foco ainda pendente**.

Nenhum arquivo funcional, commit ou deploy foi alterado por esta auditoria.
