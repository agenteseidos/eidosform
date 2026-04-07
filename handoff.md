## Handoff — Zéfa (Auditoria WhatsApp) — 2026-04-07 19:54 GMT-3

### O que foi feito
- Auditoria completa da integração WhatsApp do EidosForm
- Identificados 4 bugs (2 P0, 1 P1, 1 P2)
- Zeca corrigiu P0 e P1 — commit ef82840 em origin/main

### Decisões tomadas
- URL fallback de `localhost:3456` trocada por `https://wpp.eidosform.com.br` em todos os 3 routes
- Rate limit do QR reduzido de 60s para 30s para melhor UX
- Bug P2 (qrToPng ERR_INVALID_ARG_TYPE) não corrigido — não afeta fluxo principal (servidor usa ASCII QR, não PNG)

### Arquivos alterados
- `app/api/admin/whatsapp/status/route.ts` — URL fallback corrigida
- `app/api/admin/whatsapp/disconnect/route.ts` — URL fallback corrigida  
- `app/api/admin/whatsapp/qr/route.ts` — rate limit 60s→30s

### Estado atual
- ✅ VPS operacional: QR sendo gerado, status respondendo
- ✅ Código corrigido e em produção (commit ef82840)
- ⚠️ Variáveis de ambiente no Vercel ainda precisam ser verificadas por Sidney
- ⚠️ O erro "Empty token!" só desaparecerá quando Vercel tiver `WHATSAPP_API_KEY` configurada corretamente

### Pendências
- Sidney precisa confirmar no painel Vercel que as env vars estão setadas:
  - `WHATSAPP_API_URL` = `https://wpp.eidosform.com.br`
  - `WHATSAPP_API_KEY` = `d740b16263d6e361d169d5a9b0a7c714054160f069756eff60456ee20b8d6d76`
- Após redeploy automático do Vercel, testar login em https://eidosform.com.br/admin/whatsapp
- Bug P2 (qrToPng/PNG generation no server.js) pode ser corrigido se Sidney quiser suporte a QR em imagem futuramente

### Próximo passo sugerido
Sidney confirma env vars no Vercel → aguarda redeploy → testa `/admin/whatsapp` → escaneia QR com WhatsApp Business
