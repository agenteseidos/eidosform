## Handoff — Toin — 2026-04-22 18:50 GMT-3

### Demanda
Fase 3 do builder do EidosForm: polimento final e limpeza dos P3 baixos remanescentes da auditoria da Zéfa.

### O que foi feito
Correções concretas de baixo risco, sem regressão:

1. **Unificação handleAutosave com updateFormViaApi** — `handleAutosave` duplicava a lógica de fetch/parse/response. Agora reutiliza `updateFormViaApi`, eliminando ~15 linhas duplicadas e centralizando o erro handling.

2. **Slug error fora do flex** — A mensagem de erro do slug estava renderizando como item `flex` ao lado do input (quebrando layout). Movida para fora do container flex, agora aparece corretamente abaixo do input.

3. **Acessibilidade (aria)** — Adicionados `aria-label` nos botões ícone-only (duplicar/excluir pergunta na sidebar), `aria-invalid` e `aria-describedby` no input de slug, `role="alert"` na mensagem de erro.

### Validação
- `tsc --noEmit` → exit 0 (limpo)
- Commit `d4dbc2d` → push para main

### Arquivos alterados
- `components/form-builder/form-builder.tsx` (+27 -34)

### P3 avaliados e não corrigidos agora (justificativa)
- **Duplicação de UI condicional no question-editor.tsx** — O bloco de Exibição Condicional aparece tanto no modo `onlyLogic` quanto no modo normal. Refatorar exigiria extrair componente shared e testar ambas renderizações. Risco não justifica o ganho estético. Deixar para refactoring futuro se necessário.
- **Preview sem validação visual de required** — O preview é read-only/builder. Validação de required só faz sentido no player real. Não é gap real.

### Pendências
- Nenhuma bloqueante para o builder

### Próximo passo
Builder está pronto para entrega. Próximo foco pode ser player, dashboard, ou features novas.
