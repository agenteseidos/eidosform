## Handoff — Zeca — 2026-04-06 21:56

### O que foi feito
- Implementadas 3 APIs de gerenciamento WhatsApp no painel admin

### APIs criadas
1. **POST /api/admin/whatsapp/qr** — Gera QR code PNG real a partir do output do `wacli auth`. Rate limit 1/min.
2. **GET /api/admin/whatsapp/status** — Retorna `{ authenticated, connected, phoneNumber }` via `wacli auth status --json`
3. **POST /api/admin/whatsapp/disconnect** — Desconecta via `wacli auth logout`

### Decisões tomadas
- QR parsing: converte Unicode block art (█▀▄) para matriz booleana, depois gera PNG com `pngjs`
- Rate limit: variável em memória (suficiente para single-server, não funciona em serverless multi-instance)
- Erros internos nunca são expostos — sempre resposta genérica 500
- Todas as rotas usam `requireAdmin()` (pattern existente do projeto)

### Arquivos alterados
- `app/api/admin/whatsapp/qr/route.ts` (novo)
- `app/api/admin/whatsapp/status/route.ts` (novo)
- `app/api/admin/whatsapp/disconnect/route.ts` (novo)
- `package.json` — adicionado `pngjs`
- `package-lock.json` — atualizado

### Estado atual
- ✅ TypeScript strict, zero erros (`tsc --noEmit`)
- ✅ Commit `6a08a90` pushed para origin/main

### Pendências
- Nenhuma

### Próximo passo sugerido
- QA com Zéfa se necessário
