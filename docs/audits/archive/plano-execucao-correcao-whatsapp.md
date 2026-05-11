# Plano de Execução — Correção WhatsApp (Bloco N)

> **Origem:** [auditoria-whatsapp-2026-05-04.md](auditoria-whatsapp-2026-05-04.md) — 11 achados (2 P0, 4 P1, 3 P2, 2 P3)
> **Branch:** `feat/admin-whatsapp-2026-05`
> **Tempo estimado:** ~2h (sem rotação de chave) ou ~2h30 (com rotação)

---

## Como trabalhar

1. Etapas em **ordem** (não pular, não misturar).
2. Após cada etapa: commit conventional + breve validação manual.
3. Decisão de produto explicitamente flagada (P1-W4: hashear phone no DB).
4. Cleanup destrutivo (`rm -rf`) **exige confirmação explícita** do Sidney mesmo em Auto Mode.

---

## Etapa N1 — Corrigir `LOG_FILE` no server.js (P1-W1)

**Arquivo:** [services/whatsapp/server.js](services/whatsapp/server.js) linha 15

**Mudança:**
```js
// ANTES
const LOG_FILE = '/home/sidney/eidosform-whatsapp/server.log';

// DEPOIS
const LOG_FILE = path.join(__dirname, 'server.log');
```

**Validação:**
- Após pm2 reload, esperado: novo `server.log` aparece em `services/whatsapp/server.log`.
- Logrotate (`/etc/logrotate.d/eidosform-whatsapp`) já aponta pra esse path → vai funcionar.

**Critério de done:** novo log gravado no path correto após reload.

---

## Etapa N2 — Corrigir lógica de `phone vazio` (P1-W3)

**Arquivo:** [lib/integration-stubs.ts](lib/integration-stubs.ts)

**Mudança 1 — não enviar quando phone ausente:** linha 60-91 envolvendo o `try`:
```ts
// Adicionar guard antes do fetch
if (!leadData.phone || leadData.phone.trim().length === 0) {
  log('[WhatsApp] No phone provided, skipping send', { formId, responseId })
  return
}
```

**Mudança 2 — `null` em vez de `'unknown'`:** linha 109:
```ts
// ANTES
phone_number: phoneNumber || 'unknown',

// DEPOIS
phone_number: phoneNumber || null,
```

**Mudança no schema:** [supabase/migrations/20260405_whatsapp_logs.sql](supabase/migrations/20260405_whatsapp_logs.sql) linha 6 declara `phone_number text not null`. Como NUNCA mais vamos inserir vazio (sai pelo guard antes), pode manter NOT NULL. Mas pra registros antigos com `'unknown'`, considerar migration de UPDATE.

**Migration nova:** `supabase/migrations/20260504_normalize_whatsapp_unknown_phones.sql`:
```sql
-- Normalize 'unknown' phone_number values to NULL (allows distinguishing from real numbers)
alter table form_whatsapp_logs alter column phone_number drop not null;
update form_whatsapp_logs set phone_number = null where phone_number = 'unknown';
```

**Validação:**
- TypeScript compila sem erros (`npx tsc --noEmit`).
- Submeter form sem phone configurado: WhatsApp não é enviado, log no DB recebe `null`.

---

## Etapa N3 — Melhorar UI do admin (P2-W1)

**Arquivo:** [app/api/admin/whatsapp/logs/route.ts](app/api/admin/whatsapp/logs/route.ts)

**Mudança 1 — fallback de form sem título:**
```ts
// linha 52
formsById = new Map(
  (forms ?? []).map((form) => [
    form.id,
    form.title?.trim() || `Form #${form.id.slice(0, 8)}`
  ])
)
```

**Mudança 2 — recipient mais descritivo:**
```ts
// linha 58
recipient: log.phone_number || '(sem telefone)',
```

**Validação:**
- Olhar `/admin/whatsapp` após mudança: sem `'unknown'` nem `'Formulário sem título'` literal.

---

## Etapa N4 — Extrair helper `getWhatsappBase()` (P2-W2)

**Arquivo novo:** `lib/whatsapp-client.ts`
```ts
export function getWhatsappBase(): string {
  return process.env.WHATSAPP_API_URL || 'https://wpp.eidosform.com.br'
}

export function getWhatsappUrl(path: string): string {
  return `${getWhatsappBase()}${path.startsWith('/') ? path : `/${path}`}`
}
```

**Arquivos atualizados:**
- `app/api/admin/whatsapp/status/route.ts` — usar `getWhatsappUrl`
- `app/api/admin/whatsapp/disconnect/route.ts` — idem
- `app/api/admin/whatsapp/qr/route.ts` — idem
- `app/api/whatsapp/send/route.ts` — corrigir porta (3457 não 3456) + usar helper

**Validação:** `grep -rn "wpp.eidosform.com.br\|WHATSAPP_API_URL" app/` → só aparece em `whatsapp-client.ts`.

---

## Etapa N5 — Cleanup do diretório legado (P0-W2 + P1-W2)

⚠️ **AÇÃO DESTRUTIVA — exige confirmação do Sidney explicitamente em runtime.**

**Pré-condições:**
- ✅ N1 aplicado (logs vão pro path novo).
- ✅ pm2 reapontado pra path novo (já feito durante deploy desta sessão).
- ✅ confirmação manual: `sudo lsof | grep eidosform-whatsapp` retorna vazio (nenhum processo lendo do path antigo).

**Passos:**
1. **Backup:** copiar `server.log` antigo (54MB) pra `/home/sidney/backups/eidosform-whatsapp-server-log-2026-05-04.log.gz`.
2. **Backup:** copiar `.git/` antigo pra `/home/sidney/backups/eidosform-whatsapp-git-2026-05-04.tar.gz` (em caso de precisar do histórico).
3. `rm -rf /home/sidney/eidosform-whatsapp/` (apenas após backup confirmado).
4. Validar: `ls /home/sidney/eidosform-whatsapp/` → "No such file".

**Critério de done:** diretório some, ~149MB liberados, sem processos quebrados.

---

## Etapa N6 — Rotacionar `WHATSAPP_API_KEY` (P0-W1)

⚠️ **EXIGE COORDENAÇÃO** — chave usada na VPS + Vercel simultaneamente. Janela de risco curta.

**Passos:**
1. Gerar nova chave: `openssl rand -hex 32`.
2. Atualizar `services/whatsapp/.env` na VPS:
   ```
   INTERNAL_API_SECRET=<nova-chave>
   PORT=3457
   ```
   (Note: o server.js usa `INTERNAL_API_SECRET || WHATSAPP_API_KEY`, então usar `INTERNAL_API_SECRET` é o nome moderno.)
3. `sudo -u sidney pm2 reload eidosform-whatsapp` (pega novo .env).
4. Atualizar Vercel env: `WHATSAPP_API_KEY` (nome usado pelas rotas TS) → mesmo valor da nova chave.
5. Trigger deploy novo na Vercel pra carregar a env nova.
6. Validar:
   - `curl -H 'Authorization: Bearer <chave-VELHA>' https://wpp.eidosform.com.br/api/whatsapp/status` → 403
   - `curl -H 'Authorization: Bearer <nova>' ... ` → 200
   - Submeter form: WhatsApp ainda chega (Vercel + VPS sincronizadas).

**Critério de done:** chave antiga rejeitada, nova aceita, fluxo end-to-end funcional.

---

## Etapa N7 — Decisão de produto: hashear `phone_number` no DB? (P1-W4)

**Não-executiva** — depende de Sidney.

**Pergunta:** o owner do form precisa ver o telefone real do respondente nos logs do admin (`/admin/whatsapp`)?

- **Se SIM:** manter `phone_number` em texto puro. Aceitar risco residual (RLS já protege, só service_role + dono do form veem).
- **Se NÃO:** aplicar `hashPhone` antes de inserir + adicionar coluna `phone_hash text` (a coluna `phone_number` poderia armazenar últimos 4 dígitos `***1234` para identificação visual).

**Default sugerido:** manter texto puro (decisão atual já protegida por RLS) — a hash quebra UX do admin sem ganho de segurança real (RLS já filtra).

**Output:** Sidney decide; se SIM, executar; se NÃO, fechar como "aceito".

---

## Etapa N8 — Smoke + relatório de correções

**Smoke:**
- POST `/api/whatsapp/send` com payload válido → mensagem chega no WhatsApp.
- POST `/api/whatsapp/send` sem `phone` → não envia (N2).
- `/admin/whatsapp` → "Últimos envios" sem `'unknown'` nem `'Formulário sem título'` (N3).
- `tail /home/sidney/eidosform/services/whatsapp/server.log` → log gravando aqui (N1).

**Relatório:** `relatorio-correcao-whatsapp.md` com:
- Cada etapa: status, commit, arquivos alterados, validação.
- Achados extras descobertos.
- Próximos passos.

---

## Sequência recomendada

| Ordem | Etapa | Pode rodar em paralelo? |
|---|---|---|
| 1 | N1 (LOG_FILE) | Sim, com N2/N3/N4 |
| 2 | N2 (phone vazio) | Sim |
| 3 | N3 (UI admin) | Sim |
| 4 | N4 (helper getWhatsappBase) | Sim |
| 5 | **PR + deploy + reload** | Após 1-4 |
| 6 | N7 (decisão produto) | Async — Sidney decide |
| 7 | N5 (cleanup destrutivo) | Após N1 confirmado em prod |
| 8 | N6 (rotação chave) | Por último (mais crítico em prod) |
| 9 | N8 (smoke) | Final |

**Início recomendado:** N1+N2+N3+N4 em sequência rápida (1 commit cada), PR, deploy, validar prod, depois N5+N6 com cuidado.
