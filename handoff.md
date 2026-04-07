## Handoff — Zéfa (QA) — 2026-04-06 22:20

### O que foi feito
- Auditoria completa de toda a integração WhatsApp (17 arquivos)
- 3 bugs P1 corrigidos e commitados (94590b1)
- `npx tsc --noEmit` passou limpo

### Bugs corrigidos (P1)
1. **`lib/whatsapp.ts`**: `getWhatsAppSettings` usava anon key — falhava com RLS em server-side. Corrigido para usar service role.
2. **`components/form-builder/whatsapp-panel.tsx`**: toggling OFF não persistia (early return quando `enabled=false`). Removido o guard. Adicionado fallback PATCH→POST para criar settings quando não existem.
3. **`app/api/admin/whatsapp/qr/route.ts`**: mensagem de rate limit agora mostra segundos restantes em vez de mensagem genérica.

### Bugs mantidos como P2/P3
- **P2-1**: Rate limit QR é in-memory por processo (perde em serverless cold start) — mesmo comportamento de antes, não bloqueante
- **P2-2**: Logs de envio são mock — backend real pendente (já documentado)
- **P2-3**: Validação de telefone BR-only no builder (`+55...`) vs aceita qualquer 10-15 dígitos no backend — inconsistência
- **P2-4**: `integration-stubs.ts` envia bearer vazio se `INTERNAL_API_SECRET` não configurado — falha silenciosa
- **P2-5**: `send/route.ts` usa `setInterval` para cleanup que nunca é limpo em shutdown — minor leak
- **P3-1**: `lib/whatsapp.ts` cria 2 clients Supabase no module level mesmo que só use um
- **P3-2**: QR parse trata cada linha como módulo único (funcional, subótimo)

### Arquivos auditados (17)
- ✅ `app/api/admin/whatsapp/qr/route.ts` — corrigido
- ✅ `app/api/admin/whatsapp/status/route.ts` — ok
- ✅ `app/api/admin/whatsapp/disconnect/route.ts` — ok
- ✅ `app/api/whatsapp/send/route.ts` — ok (P2 notados)
- ✅ `app/api/whatsapp/settings/route.ts` — ok
- ✅ `app/api/whatsapp/settings/[formId]/route.ts` — ok
- ✅ `app/api/form/[id]/whatsapp/test/route.ts` — ok
- ✅ `app/api/form/[id]/whatsapp/settings/route.ts` — ok
- ✅ `lib/whatsapp.ts` — corrigido (service role)
- ✅ `lib/types/whatsapp.ts` — ok
- ✅ `lib/integration-stubs.ts` — ok (P2-4 notado)
- ✅ `lib/form-integrations.ts` — ok
- ✅ `components/admin/admin-whatsapp-panel.tsx` — ok
- ✅ `components/form-builder/whatsapp-panel.tsx` — corrigido (2 bugs)
- ✅ `app/(admin)/admin/whatsapp/page.tsx` — ok
- ✅ `supabase/migrations/20260405_form_whatsapp_settings.sql` — ok
- ✅ `supabase/migrations/20260405_whatsapp_logs.sql` — ok

### Estado atual
- ✅ Zero P0/P1
- ✅ Pushed para origin/main (94590b1)
- Feature pronta para deploy

### Problema reportado (Rate Limit QR)
O rate limit in-memory conta qualquer requisição anterior (incluindo do próprio painel). Se o usuário clicou uma vez e clicou de novo em <60s, recebia "Rate limited" genérico. Agora mostra segundos restantes. Causa raiz: rate limit é por processo — não distingue origem (terminal vs painel). Para resolver completamente, precisaria de rate limit externo (Redis), mas é P2.

### Próximo passo sugerido
- Deploy
- Implementar logs reais de envio (P2-2)
- Considerar rate limit externo para produção (P2-1)
