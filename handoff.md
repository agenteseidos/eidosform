## Handoff — Toin (Frontend/Backend) — 2026-04-07 00:10

### O que foi feito
- Migração completa: WhatsApp routes de wacli local → VPS proxy
- 4 rotas atualizadas com fetch HTTP para VPS
- TypeScript strict: zero erros de compilação
- Commit + push para origin/main (a3c1ad2)

### Rotas alteradas
1. **`app/api/admin/whatsapp/qr/route.ts`**
   - Removido: `execFile` com wacli, `pngjs`, parse ASCII QR
   - Adicionado: fetch GET `http://localhost:3456/api/whatsapp/qr`
   - Resposta: PNG direto do VPS (já renderizado)

2. **`app/api/admin/whatsapp/status/route.ts`**
   - Removido: `execFile` com wacli
   - Adicionado: fetch GET `http://localhost:3456/api/whatsapp/status`
   - Fallback: retorna `{ authenticated: false, ... }` se VPS cai

3. **`app/api/admin/whatsapp/disconnect/route.ts`**
   - Removido: `execFile` com wacli
   - Adicionado: fetch POST `http://localhost:3456/api/whatsapp/disconnect`
   - Error handling: detecta status 502/503

4. **`app/api/whatsapp/send/route.ts`**
   - Removido: `sendViaWacli()` com execFile
   - Adicionado: `sendViaVps()` com fetch POST
   - Endpoint VPS: `/api/whatsapp/send` com `{ to, message }`
   - Mantém: rate limiting in-memory, form-aware/direct modes
   - Logs: usa `logError`/`logWarn` (já existente)

### Env vars (Vercel)
- `WHATSAPP_API_URL` (default: `http://localhost:3456`)
- `WHATSAPP_API_KEY` (Bearer token: `d740b16263d6e361d169d5a9b0a7c714054160f069756eff60456ee20b8d6d76`)

### Dependências removidas
- ❌ `execFile`, `promisify` de `child_process` (não roda mais wacli)
- ❌ `pngjs` (VPS gera PNG)
- ❌ `util` (não precisa mais)

### Error handling robusto
- Timeout: 15s QR, 10s status, 15s disconnect, 30s send
- Detecta VPS down: ECONNREFUSED, timeout → "unavailable"
- Detecta auth fail: 401/403 → "not authenticated"
- Detecta indisponibilidade: 503 → "service unavailable"
- Fallbacks: status/disconnect retornam 200 mesmo com erro (graceful)

### Validação TypeScript
```
npx tsc --noEmit → ✅ zero erros
```

### Commit
```
a3c1ad2 refactor: migrate WhatsApp routes from wacli to VPS proxy integration
```

Push confirmado para origin/main. `git log origin/main..HEAD` retorna vazio.

### Estado atual
- ✅ 4 rotas funcionais com VPS proxy
- ✅ Zero erros TypeScript
- ✅ Rate limiting mantido
- ✅ Form-aware e direct modes mantidos
- ✅ Pushed para origin/main
- ✅ Pronto para deploy

### Pendências
- Deploy em Vercel com env vars configuradas
- Testar conectividade VPS → http://localhost:3456
- Verificar que API key é válida

### Próximo passo sugerido
- Zéfa entra para QA automática
- Se OK → deploy
- Se bugs → relatório e volta aqui
