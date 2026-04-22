## Handoff — Zéfa — 2026-04-22 18:24 GMT-3

### Demanda
Auditar as correções da Fase 1 do builder do EidosForm (commit `0e72446`).

### O que foi feito
Auditoria completa dos 7 pontos da Fase 1:

1. **✅ Feedback de erro no autosave** — `toast.error` + indicador visual "Erro ao salvar" no header. Reseta após 5s.
2. **✅ Unificação de payload** — Autosave e save manual ambos usam `buildFormPayload()` + API route `/api/forms/[id]`.
3. **✅ Google Sheets no autosave** — `buildFormPayload()` inclui campos de sheets. Autosave passa pela API route correta.
4. **✅ `is_published` removido** — Nenhuma referência no código. Publicação usa `status: 'published'`.
5. **✅ Confirmação ao deletar pergunta** — Dialog com nome da pergunta, botões Cancelar/Excluir (destructive).
6. **✅ Proteção contra remoção total de opções** — `updateQuestion` rejeita update que resultaria em `options: []` para dropdown/checkboxes.
7. **Classificação de bugs remanescentes** — Nenhum P0/P1/P2. Um P3 menor (ver abaixo).

### Resultado
**Fase 1 está limpa.** Todas as correções estão corretas e completas.

### Bugs remanescentes
- **P3** — `handleAutosave` faz fetch direto em vez de usar `updateFormViaApi`. Funcionalmente idêntico, mas é duplicação de código. Sugestão: unificar.

### Arquivos auditados
- `components/form-builder/form-builder.tsx` (único arquivo alterado no commit)

### Pendências
- Nenhuma para Fase 1

### Próximo passo
Fase 2 (UX que impacta vendas): P2-1 slug validação em tempo real, P2-2 botão Publicar mobile, P2-6 forçar título, P2-7 WhatsApp settings
