# QA Report — VPS WhatsApp Integration
**Auditora:** Zéfa  
**Data:** 2026-04-06 23:42  
**Commit:** a3c1ad2  

---

## 1. Código das 4 Rotas Atualizadas

### ✅ `/app/api/admin/whatsapp/qr/route.ts`
- ✅ Fetch com timeout (15s)
- ✅ Auth header sempre presente (`Bearer ${WHATSAPP_API_KEY}`)
- ✅ Error handling robusto (401/403/503/timeout)
- ✅ Rate limit aplicado (60s entre requisições)
- ✅ Resposta correta (PNG binary, headers Cache-Control corretos)

### ✅ `/app/api/admin/whatsapp/status/route.ts`
- ✅ Fetch com timeout (10s)
- ✅ Auth header sempre presente
- ✅ Fallback gracioso: VPS down → retorna `{ authenticated: false, connected: false }`
- ✅ Parsing seguro de resposta (null coalescing)
- ✅ Admin auth requerido

### ✅ `/app/api/admin/whatsapp/disconnect/route.ts`
- ✅ Fetch com timeout (15s)
- ✅ Auth header sempre presente
- ✅ Error handling para 401/403/503
- ✅ Admin auth requerido

### ✅ `/app/api/whatsapp/send/route.ts`
- ✅ Fetch com timeout (30s) — apropriado para send
- ✅ Auth header sempre presente
- ✅ Rate limiting in-memory (100 sends/phone/hora)
- ✅ Validação de telefone (11-15 dígitos)
- ✅ Dois modos: form-aware + direct (legacy)
- ✅ `INTERNAL_API_SECRET` validado antes de processar
- ✅ Erros específicos: 401 → NOT_AUTH, 503 → UNAVAILABLE, timeout → UNAVAILABLE
- ✅ Fallback QR generate quando VPS down

---

## 2. TypeScript Check

```
✅ ZERO ERROS
npx tsc --noEmit → exit code 0
```

---

## 3. Environment Variables

### ⚠️ **P1 ENCONTRADA**: Variáveis não documentadas

**Problema:**
- `.env.example` não contém `WHATSAPP_API_URL`, `WHATSAPP_API_KEY`, `INTERNAL_API_SECRET`
- Desenvolvedores não saberão configurar antes de rodar

**Fixado:**
- Adicionadas 3 variáveis ao `.env.example` com instruções

---

## 4. Fallbacks & Error Handling

### VPS Down (ECONNREFUSED, timeout)
- ✅ QR: retorna 500 + erro descritivo
- ✅ Status: retorna 200 + fallback `{ authenticated: false, connected: false }`
- ✅ Disconnect: retorna 500 + erro descritivo
- ✅ Send: retorna 503 + "VPS server unreachable"

### Authentication 401/403
- ✅ QR: retorna 502 + erro genérico
- ✅ Send: retorna 503 + "VPS authentication failed"

### Rate Limit (429)
- ✅ QR: aplica 60s delay entre requisições
- ✅ Send: máx 100 sends/phone/hora, retorna 429 com mensagem clara

### Timeout
- ✅ Todos têm timeout configurado (10s-30s)
- ✅ Tratamento de AbortError

---

## 5. Rate Limiting

### Implementação Atual
- **In-memory Map** no `/api/whatsapp/send`
- Tracks: `phone → { count, resetAt }`
- Cleanup automático a cada 10 minutos
- **MAX_SENDS_PER_HOUR = 100**

### ⚠️ **P1 ENCONTRADA**: Rate limiting não é redundante

**Problema:**
- In-memory only → se Vercel reinicia o container, counter zera
- Múltiplas instâncias Vercel não compartilham estado
- Um atacante pode enviar 100+ msgs/hora conectando a diferentes instâncias

**Opções de fix:**
1. Mover validação para VPS (ideal, já tem wacli)
2. Redis no Vercel (custo adicional)
3. Aceitar risco + monitorar

**Recomendação:**
- VPS deve aplicar rate limit também (dupla validação)
- Documentar que Vercel é apenas primeira linha

---

## 6. Security Audit

### API Key Handling
- ✅ Env var, nunca hardcoded
- ✅ Bearer token sempre no header
- ✅ Never logged ou exposto em erro público

### INTERNAL_API_SECRET
- ✅ Validação antes de form-aware send
- ✅ Bearer token format
- ✅ Fallback recusa requisição com 401

### Client-side Exposure
- ✅ API key NÃO em público (enviado no Header, servidor-side)
- ✅ `/api/whatsapp/send` requer Bearer token válido
- ✅ `/api/admin/whatsapp/*` requer `requireAdmin`

### Timeout
- ✅ Todos têm timeout (não deixa hanging)
- ✅ QR: 15s, Status: 10s, Send: 30s

---

## 7. Admin UI

### ✅ `/components/admin/admin-whatsapp-panel.tsx`

- ✅ Polling cada 3s enquanto QR não é escaneado
- ✅ QR expira em 60s (UI mostra botão "Gerar novo")
- ✅ Status endpoint retorna `{ authenticated, connected, phoneNumber }`
- ✅ Logs de envio (atualmente MOCK)
- ✅ Disconnect com confirmação
- ✅ Cleanup de Object URLs correto

### ⚠️ **OBSERVAÇÃO**: Logs ainda são MOCK

**Estado:** "Dados de demonstração. Logs reais serão exibidos quando o backend de envio estiver integrado."

**Ação:** Confirmar se Toin já integrou logging real ou se fica para próxima rodada.

---

## Summary

| Item | Status | Notes |
|------|--------|-------|
| Código das 4 rotas | ✅ APROVADO | Fetch, timeouts, auth, error handling corretos |
| TypeScript | ✅ ZERO ERROS | npx tsc --noEmit |
| Env vars | ⚠️ P1 FIXADO | Variáveis adicionadas ao .env.example |
| Fallbacks (VPS down, timeout, 401/403) | ✅ APROVADO | Todos tratados |
| Rate limiting | ⚠️ P1 ENCONTRADA | In-memory only, não redundante com múltiplas instâncias |
| Security (API key, Bearer, timeout) | ✅ APROVADO | Hardening completo |
| Admin UI | ✅ APROVADO | QR polling, status, disconnect funcionam |
| Logs UI | ⚠️ OBSERVAÇÃO | Ainda são MOCK — confirmar se é esperado |

---

## P0/P1 Bugs Found

### ✅ **P1 #1: Env vars não documentadas**
- **Status:** FIXADO
- **Commit:** (pendente push)

### ✅ **P1 #2: Rate limiting não redundante**
- **Status:** IDENTIFICADO
- **Recomendação:** VPS deve validar também
- **Urgência:** Média — aceitar ou implementar Redis

---

## Next Steps

1. **Push da correção P1 #1** (env vars)
2. **Decisão sobre P1 #2** (rate limiting redundante)
   - Se sim: adicionar validação no VPS
   - Se não: aceitar e documentar risco
3. **Confirmar logs reais** (atualmente MOCK)
4. **Testes de carga** na VPS: 100 sends/hora/phone
5. **Monitoramento** de falhas de autenticação VPS

---

**Zéfa**  
Auditora QA Final — EidosForm  
