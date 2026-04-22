## Handoff — Zéfa — 2026-04-22 18:44 GMT-3

### Demanda
Auditar as correções da Fase 2 do builder do EidosForm (commit `58c4350`).

### O que foi feito
Auditoria completa do diff `0e72446..58c4350` em `components/form-builder/form-builder.tsx`.

### Resultado da auditoria — ✅ LIMPO

1. **Bloqueio de publicação sem título** — ✅ `handlePublish` verifica `form.title.trim()`, exibe toast e retorna. Correto.
2. **Validação de slug em tempo real** — ✅ `validateSlug()` com 4 regras (vazio, min 3 chars, regex `[a-z0-9-]`, sem hífen nas pontas). Input aplica `setSlugError` no onChange, borda vermelha + mensagem de erro renderizadas condicionalmente. Também validado no `handlePublish`. Correto.
3. **Botão Publicar no mobile** — ✅ `<span className="hidden sm:inline">` trocado por `<span>`. Texto "Publicar" agora visível em todas as breakpoints. Correto.
4. **WhatsApp settings** — ✅ `notify_whatsapp_number` adicionado ao `buildFormPayload()` com fallback `|| null`. Antes era omitido, causando null no save. Correto.
5. **TypeScript** — ✅ `tsc --noEmit` passou limpo (exit 0).

### Bugs remanescentes
Nenhum bug encontrado. Nenhum P0/P1/P2/P3.

### Arquivos auditados
- `components/form-builder/form-builder.tsx` (diff da Fase 2)

### Pendências
- Nenhuma para Fase 2

### Próximo passo
Fase 3 ou P3 do handoff anterior (unificar handleAutosave com updateFormViaApi)
