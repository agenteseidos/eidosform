## Handoff — Zeca — 2026-04-06 16:40

### O que foi feito
- P1-1: Test endpoint payload corrigido — agora envia `{ instance, to, message }` (formato direct)
- P1-2: Form-aware send agora exige `INTERNAL_API_SECRET` — qualquer request sem auth retorna 401
- P1-3: Template building duplicado removido de `integration-stubs.ts` — agora apenas passa `{ formId, leadData }` para o send endpoint, que faz tudo
- P1-4: Check legado `notify_whatsapp_enabled` substituído por plan gating (Plus+) + delegação para `sendWhatsAppOnFormResponse` (que internamente consulta `form_whatsapp_settings`)

### Decisões tomadas
- Auth no form-aware send: exigido `isInternal` (INTERNAL_API_SECRET), mesmo para server-to-server
- Template building: fonte única de verdade no `buildMessage()` do send endpoint
- Legacy WhatsApp fields: removidos do gate em responses/route.ts; plan gating substitui

### Arquivos alterados
- `app/api/form/[id]/whatsapp/test/route.ts` — payload fix
- `app/api/whatsapp/send/route.ts` — auth gate no form-aware
- `lib/integration-stubs.ts` — removida lógica duplicada de template
- `app/api/responses/route.ts` — removido check legado, adicionado plan gating

### Estado atual
- TypeScript: ✅ zero erros
- Commit: `5a079de` pushed to main
- Todos os 4 P1 corrigidos

### Pendências
- P2 bugs (5-10) da auditoria da Zéfa ainda estão abertos (rate limiter in-memory, hardcoded instances, etc.)
- Revalidação da Zéfa necessária para confirmar fixes

### Próximo passo sugerido
- Zéfa revalida os 4 P1 fixes
