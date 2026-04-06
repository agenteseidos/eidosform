## Handoff — Zéfa (QA) — 2026-04-06 16:30

### Auditoria: Integração WhatsApp (Etapas 2-5)

**TypeScript: ✅ ZERO erros** (`npx tsc --noEmit` limpo)

---

### Bugs encontrados

#### **P1 — Crítico**

1. **Test endpoint envia payload incompatível com `/api/whatsapp/send`**
   - Arquivo: `app/api/form/[id]/whatsapp/test/route.ts` linha ~90
   - O test endpoint envia `{ phone_number, message, instance_name, test_mode }` para `/api/whatsapp/send`
   - O send endpoint espera `{ formId, leadData }` (form-aware) ou `{ instance, to, message }` (direct)
   - O payload enviado não bate em nenhum dos dois formatos: `phone_number` ≠ `to`, falta `formId`/`leadData`
   - **Resultado:** mensagem de teste SEMPRE falha com erro 400
   - **Fix:** usar formato direct: `{ instance: instance_name, to: owner_phone, message: message_template }`

2. **WhatsApp integration duplica lógica de template building**
   - `lib/integration-stubs.ts` faz replace de template manualmente (linhas ~40-50)
   - `app/api/whatsapp/send/route.ts` `buildMessage()` faz o mesmo replace
   - Quando form submission dispara WhatsApp: `integration-stubs` faz fetch de settings + build message, depois chama `/api/whatsapp/send` que faz fetch de settings + build message **de novo**
   - **Resultado:** double processing + potencial de divergência de lógica
   - **Fix:** `integration-stubs` deve passar `{ formId, leadData }` para o send endpoint e deixar `buildMessage` lá. Já faz isso, MAS o double fetch de settings continua. Considerar param `skipSettingsFetch` ou refatorar.

3. **Form-aware send aceita requests sem auth de usuário**
   - Arquivo: `app/api/whatsapp/send/route.ts`
   - `handleFormAwareSend` recebe `_isInternal` mas não verifica se é true nem exige auth de usuário
   - Qualquer request com `{ formId, leadData }` no body é processada sem autenticação
   - **Risco:** abuso para enviar WhatsApp messages conhecendo apenas o formId
   - **Fix:** exigir `isInternal === true` OU auth de usuário JWT válido

4. **WhatsApp settings check em responses usa campo legado `notify_whatsapp_enabled`**
   - Arquivo: `app/api/responses/route.ts` linha ~306
   - A condição verifica `form.notify_whatsapp_enabled && form.notify_whatsapp_number` (campos legados no form)
   - Mas a nova integração usa `form_whatsapp_settings` table via `getWhatsAppSettings`
   - Dentro de `sendWhatsAppOnFormResponse`, há um segundo check com `getWhatsAppSettings` que pode retornar null
   - **Problema:** se `notify_whatsapp_enabled=true` no form mas settings não existem na tabela nova, o código faz fetch inútil e loga warn
   - **Fix:** decidir qual é a fonte de verdade. Se a tabela nova, migrar e remover check legado

#### **P2 — Melhoria**

5. **Rate limiter é in-memory, não persiste entre deploys**
   - Map em memória no `/api/whatsapp/send` reseta a cada deploy/restart
   - Em serverless, cada cold start zera o rate limit
   - Considerar Redis ou tabela no Supabase para produção

6. **`whatsAppInstances` hardcoded no componente UI**
   - `whatsapp-panel.tsx` linha com `useState<string[]>(['default', 'instancia-2', 'instancia-3'])`
   - Instâncias deveriam vir do backend/config do usuário

7. **Auto-save dispara em toda mudança incluindo disable**
   - No `useEffect` de auto-save, quando `enabled` muda para `false`, ainda tenta salvar
   - O check `if (!enabled) return` impede o save, mas o timer é criado e cancelado desnecessariamente
   - Menor problema, mas gera re-renders

8. **`logWarn` usado para mensagem de sucesso**
   - `integration-stubs.ts` última linha: `logWarn('[WhatsApp] ✅ Sent...')` 
   - Deveria ser `logInfo` ou equivalente

9. **UI valida telefone apenas formato BR (+55)**
   - `validatePhoneNumber` no componente só aceita `+55...`
   - O backend `isValidPhoneNumber` aceita 11-15 dígitos (qualquer país)
   - Inconsistência: usuário pode ter número não-BR que passa no backend mas falha na UI

10. **`integration-stubs.ts` faz fetch interno via HTTP**
    - Chama `/api/whatsapp/send` via `fetch(appUrl/api/...)` 
    - Em serverless, isso é uma cold start extra + latência
    - Considerar chamada direta à função `handleFormAwareSend` importando o módulo

---

### Estado atual
- TypeScript compila sem erros ✅
- Rotas de CRUD settings com auth/ownership ✅
- Rate limiting implementado ✅
- Fire-and-forget na form submission ✅
- Plan gating (Plus+) ✅
- UI com loading/error states ✅

### Pendências
- P1-1: Fix test endpoint payload (bloqueia teste manual)
- P1-3: Auth no form-aware send (bloqueia produção)
- P1-2 e P1-4: Consistência arquitetural

### Próximo passo sugerido
- Zeca fix P1-1 e P1-3 (backend)
- Toin fix P1-4 se envolver migração de UI
