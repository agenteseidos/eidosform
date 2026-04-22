## Handoff — Zéfa — 2026-04-22 19:23 GMT-3

### Demanda
Auditoria completa do player do EidosForm (experiência de quem responde o formulário).

### O que foi feito
Auditoria profunda de todo o fluxo do player, cobrindo:
- Fluxo de resposta (welcome → perguntas → envio → thank you)
- UX: progresso, navegação, validações, mobile, clareza visual
- Envio de respostas e edge cases
- Impacto em processos de venda/captação
- Integrações de captura (pixels, webhooks, UTMs, Google Sheets, WhatsApp)
- Acessibilidade
- Segurança

**Método:** Leitura completa dos fontes do player (form-player.tsx, question-renderer.tsx, watermark.tsx, page.tsx), API de respostas (route.ts), lógica condicional/jumps, pixels, UTM tracker, validadores de campo, e partial responses. `tsc --noEmit` passa limpo. App não estava rodando — não foi possível validação via browser.

---

### Relatório de Auditoria — Player EidosForm

## P0 — Crítico (bloqueia conversão ou causa perda de dados)

### P0-01: `respondent_id` nunca é salvo na submissão final
**Arquivo:** `app/api/responses/route.ts`  
**Problema:** Quando o usuário está autenticado e tem partial responses (via `x-response-id`), o update usa `.eq('id', existingResponseId)` — isso funciona. MAS na criação de resposta nova (sem `x-response-id`), não há `respondent_id` no insert. Se o partial save cria uma response com `respondent_id` mas o submit final ignora essa response e cria uma nova (race condition no timer de 2s), o `respondent_id` se perde.  
**Impacto:** Duplicação de respostas e perda de vínculo respondente → resposta.  
**Correção:** Garantir que o player sempre tenta recuperar o partial response ID antes de submeter, ou enviar `respondent_id` no POST final quando autenticado.

### P0-02: Footer fixo não respeita tema (hardcoded `bg-white/80 dark:bg-gray-900/80`)
**Arquivo:** `components/form-player/form-player.tsx` (footer, ~linha 845)  
**Problema:** Footer usa `bg-white/80 dark:bg-gray-900/80` hardcoded. Em temas escuros (midnight, ocean, forest), isso cria um bloco branco/cinza jarring no rodapé.  
**Impacto:** Confiança visual — parece quebrado/provisório. Reduz credibilidade profissional.  
**Correção:** Usar `theme.backgroundColor` com opacidade, ou `style={{ backgroundColor: theme.backgroundColor + 'CC' }}`.

### P0-03: Botão de submit e de navegação duplicam funcionalidade na mesma tela
**Arquivo:** `components/form-player/form-player.tsx` (~linhas 780-820 e 845-870)  
**Problema:** Há um botão "OK/Enviar" grande no corpo + botões ▲/▼ no footer fixo. Ambos chamam `goToNext()` / `goToPrevious()`. No mobile, isso consome espaço valioso. Pior: o botão ▼ no footer não tem validação (chama `goToNext()` sem `skipValidation`, mas isso valida — ok), porém o UX é confuso porque o usuário não sabe qual usar.  
**Impacto:** Confusão de UX, especialmente mobile. Dupla chance de erro.  
**Correção:** Unificar a navegação. Sugestão: manter botão principal no corpo e remover ▲/▼ do footer, OU tornar o footer mais discreto e contextual.

---

## P1 — Alto (prejudica conversão ou causa fricção significativa)

### P1-01: Progresso baseado em índice é enganoso com lógica condicional
**Arquivo:** `components/form-player/form-player.tsx` (progressFull)  
**Problema:** O progresso é calculado como `(currentIndex + 1) / visibleQuestions.length * 100`. Quando jump rules ou conditional logic escondem/mostram perguntas, `visibleQuestions` muda dinamicamente. Se o usuário está na pergunta 3 de 5 e uma condicional esconde 2 perguntas, o progresso pula de 60% para 100% abruptamente.  
**Impacto:** Usuário perde noção de progresso real. Pode desistir achando que acabou ou que o form é infinito.  
**Correção:** Considerar progresso baseado em "total de perguntas originais" em vez de visíveis, OU usar indicador não-numérico (dots/pontos).

### P1-02: "Pergunta X de Y" fica incorreto com conditional logic
**Arquivo:** `components/form-player/form-player.tsx` (~linha 730)  
**Problema:** Mostra `Pergunta {currentIndex + 1} de {visibleQuestions.length}`. Se a pergunta 2 é pulada por lógica condicional, mostra "Pergunta 2 de 4" quando na verdade é a 2ª pergunta visível de 4. Funcionalmente correto mas semanticamente confuso — o usuário pode achar que pulou algo.  
**Impacto:** Confusão moderada.  
**Correção:** Usar indicador de progresso visual (barra + %) em vez de "X de Y", ou mostrar "Pergunta X de Y (Y visíveis)".

### P1-03: Erro de validação do frontend não é exibido em checkboxes
**Arquivo:** `components/form-player/question-renderer.tsx` (case `checkboxes`)  
**Problema:** Quando checkboxes é `required` e o usuário clica "OK" sem selecionar nada, `validateCurrentQuestion` retorna false com erro "Selecione ao menos uma opção". Porém, o error é renderizado no form-player (via `errors[currentQuestion.id]`), não dentro do question-renderer. Funciona, mas o erro aparece abaixo de toda a lista de checkboxes, longe do contexto visual.  
**Impacto:** Usuário pode não ver o erro, especialmente em telas longas.  
**Correção:** Passar `error` prop para dentro do question-renderer e exibir inline com as opções.

### P1-04: Calendly widget não avança automaticamente após agendamento
**Arquivo:** `components/form-player/question-renderer.tsx` (CalendlyQuestion)  
**Problema:** Após o agendamento (`event_scheduled`), o widget mostra "Agendamento confirmado!" mas não avança para a próxima pergunta. O usuário precisa clicar manualmente em "OK" ou ▼.  
**Impacto:** Fricção desnecessária. Usuário pode não saber que precisa avançar.  
**Correção:** Auto-avançar após confirmação (chamar `onSubmit(true, eventUri)` no handler de `calendly.event_scheduled`).

### P1-05: Sem feedback visual ao salvar progresso parcial
**Arquivo:** `components/form-player/form-player.tsx` (savePartialResponseDebounced)  
**Problema:** O partial save é totalmente silencioso. Se falhar, o usuário não sabe. Se o navegador fechar antes dos 2s de debounce, perde tudo.  
**Impacto:** Usuário pode perder progresso sem aviso. Reduz confiança.  
**Correção:** Pelo menos um indicador sutil ("Progresso salvo" toast ou ícone) após save bem-sucedido. Não precisa ser intrusivo.

### P1-06: Navegação por ArrowUp/ArrowDown pode conflitar com scroll
**Arquivo:** `components/form-player/form-player.tsx` (keyboard handler)  
**Problema:** `ArrowUp` e `ArrowDown` chamam `goToPrevious()` e `goToNext()` com `e.preventDefault()`. Isso impede o scroll natural da página. Em forms com conteúdo longo (endereço, checkboxes com muitas opções), o usuário não consegue rolar com teclado.  
**Impacto:** Acessibilidade ruim. Usuário de teclado não consegue ver todas as opções.  
**Correção:** Remover navegação por Arrow keys ou condicionar (ex: só quando focus está fora de áreas scrolláveis).

---

## P2 — Médio (degrada experiência mas não bloqueia)

### P2-01: Footer fixo pode cobrir conteúdo em mobile
**Arquivo:** `components/form-player/form-player.tsx`  
**Problema:** Footer fixo com `pb-24` no main compensa, mas em perguntas com muito conteúdo (address com 7 campos), o último campo pode ficar parcialmente coberto. O `pb-24` pode ser insuficiente dependendo do viewport.  
**Impacto:** Frustração leve em mobile.  
**Correção:** Aumentar padding-bottom ou usar `pb-[calc(env(safe-area-inset-bottom)+6rem)]`.

### P2-02: Imagem do welcome pode quebrar layout se muito grande
**Arquivo:** `components/form-player/form-player.tsx` (welcome screen)  
**Problema:** `welcome_image_url` é renderizado com `max-h-20` e `object-contain`, mas não há `width` controlado. Se a imagem for muito larga, pode expandir o container.  
**Impacto:** Visual quebrado.  
**Correção:** Adicionar `max-w-full` à Image do welcome.

### P2-03: Dropdown do país (Phone) pode sair da tela em mobile
**Arquivo:** `components/form-player/question-renderer.tsx` (PhoneQuestion)  
**Problema:** Dropdown de países tem `max-w-[calc(100vw-2rem)]` e `max-h-[280px]`, mas é `absolute top-full right-0`. Em mobile, pode ser cortado pela borda direita.  
**Impacto:** Usuário não consegue selecionar país em algumas situações.  
**Correção:** Usar `left-0` em mobile ou adicionar scroll horizontal.

### P2-04: Content block vazio mostra "(Conteúdo não preenchido)" em produção
**Arquivo:** `components/form-player/question-renderer.tsx` (case `content_block`)  
**Problema:** Se o builder não preencheu o conteúdo do content_block, o player exibe "(Conteúdo não preenchido)" em itálico. Isso vaza detalhes internos para o respondente.  
**Impacto:** Impressão amadora.  
**Correção:** Se `contentHtml` é vazio, mostrar apenas o botão "Continuar" sem texto.

### P2-05: Acessibilidade — falta de aria-label, role, e focus management
**Arquivo:** `components/form-player/form-player.tsx` e `question-renderer.tsx`  
**Problema:** 
- Erros de validação não têm `role="alert"` ou `aria-live`
- Botão de submit não indica se é último passo via aria
- Progresso não tem `role="progressbar"` com `aria-valuenow`
- Quando pergunta muda, focus não é movido para o novo conteúdo
- Número da pergunta não usa `aria-label` semântico  
**Impacto:** Screen readers não conseguem navegar adequadamente.  
**Correção:** Adicionar roles e aria attributes. Implementar focus trap management.

### P2-06: PixelInjector é renderizado DUAS vezes (welcome + main)
**Arquivo:** `components/form-player/form-player.tsx`  
**Problema:** `PixelInjector` aparece tanto no welcome screen quanto no formulário principal. Embora Meta Pixel seja injetado server-side e o PixelInjector não o duplique (tem comentário "já injetado server-side"), Google Ads e TikTok são injetados via `<Script>` em ambas as renderizações. Se React remountar, os scripts podem ser duplicados.  
**Impacto:** Eventos duplicados em pixels. Dados de conversão inflados.  
**Correção:** Mover PixelInjector para um componente pai que não re-renderiza entre welcome e form, ou usar flag para evitar dupla injeção.

### P2-07: Redirecionamento após submit tem delay fixo de 2.8s
**Arquivo:** `components/form-player/form-player.tsx` (handleSubmit)  
**Problema:** `setTimeout(() => { window.location.href = ... }, 2800)` é hardcoded. Se a thank you page tem botão CTA + redirect, o usuário vê a mensagem por 2.8s fixos. Não há forma de configurar isso por formulário.  
**Impacto:** Pode ser muito rápido (não dá tempo de ler) ou muito lento (frustrante).  
**Correção:** Tornar o delay configurável ou usar progress indicator.

---

## P3 — Baixo (polimento, edge cases raros)

### P3-01: Navegação por history stack pode causar loop
**Arquivo:** `components/form-player/form-player.tsx` (goToPrevious)  
**Problema:** `navigationHistory` guarda índices de perguntas. Se o usuário vai de Q1 → Q2 → Q1 (via jump), o history é [0, 1]. Voltar de Q1 vai para Q2. Voltar de Q2 vai para Q1. Funciona, mas pode ser confuso com jumps.  
**Impacto:** Muito raro, apenas com jump rules complexas.

### P3-02: Shortcuts de teclado (A, B, C...) só funcionam quando focus não está em input
**Arquivo:** `components/form-player/question-renderer.tsx`  
**Problema:** Atalhos são ignorados se o focus está em INPUT ou TEXTAREA. Isso é correto (não quer interferir com digitação), mas não é documentado.  
**Impacto:** Usuário pode não saber que atalhos existem.

### P3-03: Memória customizada do QuestionRenderer usa JSON.stringify para comparação
**Arquivo:** `components/form-player/question-renderer.tsx` (memo comparator)  
**Problema:** `JSON.stringify(prevProps.value) === JSON.stringify(nextProps.value)` é O(n) e pode ser lento com arrays grandes (checkboxes com muitas opções).  
**Impacto:** Desempenho em edge cases com muitas opções.

### P3-04: Formulário sem perguntas mostra "Este formulário ainda não tem perguntas."
**Arquivo:** `components/form-player/form-player.tsx`  
**Problema:** Se todas as perguntas são conditional e nenhuma é visível, o form mostra mensagem de vazio. Mas isso pode ser um bug do builder, não do player.  
**Impacto:** Raro, depende de configuração.

### P3-05: Honeypot field não é implementado no player
**Arquivo:** `app/api/responses/route.ts` (comentário sobre _hp_)  
**Problema:** O backend verifica honeypot `_hp_`, mas o player nunca envia esse campo. A proteção existe mas não é ativada.  
**Impacto:** Proteção anti-bot subutilizada.  
**Correção:** Adicionar hidden input `_hp_` no player.

### P3-06: meta_events captured podem ser perdidos se submit acontece antes do pixel carregar
**Arquivo:** `hooks/use-meta-events-capture.ts`  
**Problema:** O hook captura eventos custom do Meta Pixel via monkey-patching de `fbq`. Se o pixel ainda não carregou quando o form é submetido, `metaEvents` fica vazio.  
**Impacto:** Eventos custom de pixels podem não ser registrados em conexões lentas.

---

## Ordem sugerida de ataque

1. **P0-02** (footer hardcoded) — Visual imediato, fácil de corrigir
2. **P0-03** (dupla navegação) — Redesign da navegação, alto impacto em UX
3. **P0-01** (respondent_id) — Investigar race condition e corrigir
4. **P1-06** (Arrow keys vs scroll) — Remover ou condicionar
5. **P1-04** (Calendly auto-advance) — Fácil, alto valor
6. **P2-06** (PixelInjector duplicado) — Pode estar inflando dados de conversão
7. **P2-05** (acessibilidade) — Progressivo
8. **P1-01 + P1-02** (progresso enganoso) — Repensar modelo de progresso
9. **P1-03** (erro inline checkboxes) — Fácil
10. **P1-05** (feedback partial save) — Fácil
11. **P2-01 a P2-04, P2-07** — Polimento
12. **P3-05** (honeypot) — Segurança fácil
13. **P3-01 a P3-04, P3-06** — Se sobrar tempo

---

### Arquivos verificados
- `components/form-player/form-player.tsx` (870+ linhas)
- `components/form-player/question-renderer.tsx` (550+ linhas)
- `components/form-player/watermark.tsx`
- `app/f/[slug]/page.tsx`
- `app/f/[slug]/not-found.tsx`
- `app/api/responses/route.ts`
- `app/api/forms/[id]/partial-response/route.ts`
- `lib/form-logic-engine.ts`
- `lib/pixel-events.ts`
- `lib/utm-tracker.ts`
- `lib/field-validators.ts`
- `lib/themes.ts`
- `hooks/use-meta-events-capture.ts`
- `components/pixels/pixel-injector.tsx`

### Pendências
- Validação via browser não foi possível (app não estava rodando)
- Não foi possível testar fluxo real de submissão end-to-end
- Alguns P0/P1 podem mudar de severidade após teste real

### Próximo passo
Corrigir P0-02, P0-03, P0-01, P1-06 e P1-04 nesta ordem. Revalidar com browser após correções.
