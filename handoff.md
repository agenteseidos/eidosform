## Handoff — Zéfa → Sidney — 2026-04-22 21:19 GMT-3

### Demanda
Mapear (sem implementar) 4 itens: HMAC webhook, logs webhook, Meta CAPI, exportação PDF/Excel.

### O que foi feito
Mapeamento completo dos 4 itens (ver detalhes abaixo).

---

## 1. HMAC no Webhook do Asaas

**Arquivos envolvidos:**
- `app/api/webhooks/asaas/route.ts` — webhook endpoint, autenticação atual por token estático (header `asaas-access-token` ou query `accessToken`)
- `lib/logger.ts` — logger existente

**Estado atual:**
- Autenticação via token simples (`ASAAS_WEBHOOK_TOKEN`) comparado com `===`
- Sem verificação de integridade do payload
- O Asaas suporta HMAC-SHA256 via header `asaas-signature` (docs: `timestamp=v&hash=h`)

**Escopo do trabalho:**
1. Adicionar `ASAAS_WEBHOOK_SECRET` ao `.env`
2. Criar função `verifyAsaasSignature(payload: string, signature: string, secret: string)` em `lib/webhook-hmac.ts` (ou inline)
3. Modificar `route.ts` POST: ler body como texto, verificar assinatura antes de parsear JSON
4. Manter token como fallback para backward compat
5. Documentar o formato de verificação para clientes

**Complexidade:** Baixa (~1h)
**Dependências:** Nenhuma

---

## 2. Logs de Webhook

**Arquivos envolvidos:**
- `app/api/webhooks/asaas/route.ts` — endpoint
- `lib/logger.ts` — logger atual (só loga em `development`!)

**Estado atual:**
- `lib/logger.ts` só loga quando `NODE_ENV === 'development'`
- Logs existentes via `log()`, `logWarn()`, `logError()` com prefixo `[asaas-webhook]`
- Sem persistência — logs vão para stdout e somem

**Escopo do trabalho:**
1. **Logger produtivo:** Modificar `lib/logger.ts` para logar em produção (remover gate de development), ou criar logger estruturado com níveis
2. **Tabela de logs (recomendado):** Criar tabela `webhook_logs` no Supabase com campos: `id, event, payload (jsonb), status, error, created_at`
3. **Middleware de logging:** Criar `lib/webhook-logger.ts` que insere na tabela antes/after do processamento
4. **Integrar em `route.ts`:** Logar recebimento, processamento e erros
5. **Dashboard admin (futuro):** Endpoint para consultar logs

**Complexidade:** Baixa-Média (~2-3h)
**Dependências:** Migração Supabase para tabela `webhook_logs`

---

## 3. Meta CAPI (Conversions API)

**Arquivos envolvidos:**
- `components/pixels/pixel-injector.tsx` — injeção client-side de pixels (Meta, TikTok, Google Ads, GTM)
- `lib/pixel-event-engine.ts` — motor de avaliação de regras de pixel events
- `lib/pixel-events.ts` — helpers/constantes para UI
- `types/pixel-events.ts` — tipos compartilhados
- `components/form-builder/pixel-event-rules-editor.tsx` — UI de configuração de regras
- `app/f/[slug]/page.tsx` — injeção server-side do Meta Pixel (`fbq('init', ...)` e `PageView`)
- `components/form-player/form-player.tsx` — dispara eventos via `firePixelEvent()` (client-side)
- `app/api/responses/route.ts` — endpoint que recebe respostas (onde CAPI seria integrado)
- `lib/database.types.ts` — tipos do banco (coluna `pixels` no forms, `pixel_event_on_start/complete`)

**Estado atual:**
- **Pixel client-side completo:** Meta Pixel, TikTok, Google Ads, GTM — todos client-side via browser
- **Eventos condicionais:** Motor de regras avalia respostas e dispara `fbq('track')` / `fbq('trackCustom')` no browser
- **Eventos automáticos:** `onStart` → PageView, `onComplete` → CompleteRegistration + Lead
- **Zero CAPI:** Não existe nenhuma chamada server-side para Meta Conversions API

**Escopo do trabalho (Meta CAPI):**
1. **Configuração:** Adicionar `META_ACCESS_TOKEN` e `META_PIXEL_ID` ao env (token de sistema, não user token)
2. **Criar `lib/meta-capi.ts`:** Função `sendServerEvent(pixelId, accessToken, eventData)` que POSTa para `https://graph.facebook.com/v19.0/{pixelId}/events`
3. **Mapear evento CAPI:** Criar `mapResponseToCAPI(form, response)` que gera payload compatível (user_data hash, custom_data, event_name, event_time, etc.)
4. **Integrar em `app/api/responses/route.ts`:** Após salvar resposta, chamar CAPI para `Lead`/`CompleteRegistration`
5. **Deduplicação:** Usar `event_id` UUID para evitar duplo-contagem (browser + server)
6. **Hashing PII:** Implementar SHA-256 de email, phone, nome conforme spec do Meta
7. **UI (opcional):** Toggle no builder para ativar/desativar CAPI por form

**Complexidade:** Média-Alta (~4-6h)
**Dependências:** `META_ACCESS_TOKEN` (gerado no Meta Events Manager), `META_PIXEL_ID`, `crypto` (builtin)

---

## 4. Exportação PDF/Excel

**Arquivos envolvidos:**
- `app/api/forms/[id]/export/route.ts` — endpoint atual (só CSV)
- `app/api/forms/[id]/export-csv/route.ts` — endpoint CSV alternativo
- `components/responses/responses-dashboard.tsx` — UI com botão "Exportar CSV", gate por plano

**Estado atual:**
- **CSV server-side:** `GET /api/forms/[id]/export?format=csv` — completo, com BOM, UTM, meta_events
- **CSV client-side:** `exportToCSV()` inline no dashboard (fallback, mesmo código)
- **Gate por plano:** `PLANS[userPlan]?.csvExport` no endpoint
- **Zero PDF/Excel:** Não existe nenhuma dependência ou código para PDF ou Excel

**Escopo do trabalho:**

**Excel (`.xlsx`):**
1. Instalar `exceljs` ou `xlsx` (sheetjs)
2. Estender `app/api/forms/[id]/export/route.ts` para aceitar `?format=xlsx`
3. Criar `lib/export-excel.ts`: gerar planilha com headers, dados, styling básico
4. Gate por plano (mesma lógica do CSV ou plano superior)
5. Adicionar botão no `responses-dashboard.tsx`

**PDF (`.pdf`):**
1. Instalar `jspdf` + `jspdf-autotable` (server-side) ou usar `@react-pdf/renderer`
2. Estender endpoint para `?format=pdf`
3. Criar `lib/export-pdf.ts`: gerar PDF com tabela de respostas, header com logo/nome do form, metadados
4. Gate por plano
5. Adicionar botão no dashboard (dropdown com opções: CSV, Excel, PDF)

**Complexidade:** Média (~3-4h total)
**Dependências:** `exceljs` ou `xlsx` (Excel), `jspdf` + `jspdf-autotable` (PDF)

---

---

## Handoff — Sidney — 2026-04-22

### Feature 1: HMAC no Webhook do Asaas (implementado)

- `lib/webhook-hmac.ts` — `verifyAsaasSignature(payload, signatureHeader, secret)` com proteção anti-replay (5 min)
- `app/api/webhooks/asaas/route.ts` — lê body como texto, verifica HMAC se `ASAAS_WEBHOOK_SECRET` existir, fallback para token se não configurado

**Adicionar ao `.env`:**
```
ASAAS_WEBHOOK_SECRET=<segredo configurado no painel do Asaas>
```

### Feature 2: Logs de Webhook (implementado)

- `supabase/migrations/20260422_webhook_logs.sql` — tabela `webhook_logs` com RLS
- `lib/webhook-logger.ts` — função `logWebhookEvent` que insere no Supabase
- `app/api/webhooks/asaas/route.ts` — integrado: loga recebimento, OK e erros
- `lib/logger.ts` — removido gate `NODE_ENV`, loga sempre

### Feature 3: Exportação Excel (implementado)

- `lib/export-excel.ts` — gera `.xlsx` com `exceljs` (headers negrito, auto-width)
- `app/api/forms/[id]/export/route.ts` — aceita `?format=xlsx`, gate por plano `csvExport`
- `components/responses/responses-dashboard.tsx` — botão CSV virou dropdown CSV/Excel
