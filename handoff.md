## Handoff — Zeca (P1 WhatsApp Fixes) — 2026-04-06 20:30

### O que foi feito
- P1-1 (test payload): Já estava corrigido — test/route.ts usa `{ instance, to, message }`
- P1-2 (auth em form-aware): Já estava corrigido — `isInternalRequest()` verifica em ambos os modos
- P1-3 (dupla lógica template): Já estava corrigido — integration-stubs delega ao send endpoint
- P1-4 (campo legado responses): **Corrigido** — removido `notify_whatsapp_enabled` e `notify_whatsapp_number` da query em responses/route.ts

### Arquivos alterados
- `app/api/responses/route.ts` — removidos campos legados do select e type assertion
- `handoff.md` — atualizado

### Estado atual
- TypeScript strict: zero erros
- Commit: e948af9
- Push: origin/main ✅

### Decisões tomadas
- 3 dos 4 P1s já estavam resolvidos em rounds anteriores; só P1-4 precisava de limpeza

### Próximo passo sugerido
- Zéfa revalidar os 4 P1s para confirmar que estão todos resolvidos
