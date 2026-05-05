# Auditoria WhatsApp — 2026-05-04

**Projeto:** EidosForm — serviço de notificação WhatsApp via wacli
**Diretórios analisados:**
- Novo (monorepo): `/home/sidney/eidosform/services/whatsapp/`
- Legado (VPS): `/home/sidney/eidosform-whatsapp/`
**Auditor:** Claude Code (Opus 4.7, 1M context) — Auto Mode
**Tipo:** Auditoria estática read-only — sem alterações aplicadas
**Origem:** Demanda 4 do [backlog-demandas-2026-05-04.md](backlog-demandas-2026-05-04.md)

---

## Sumário Executivo

| Severidade | Total |
|---|---|
| **P0** (crítico) | 2 |
| **P1** (grave) | 4 |
| **P2** (médio) | 3 |
| **P3** (cosmético) | 2 |
| **Total** | **11** |

**Veredito:** a migração `/home/sidney/eidosform-whatsapp/` → `services/whatsapp/` foi **incompleta**. O código novo está versionado e em uso (validamos durante o Bloco H que `hashPhone` está ativo em produção), mas o **diretório antigo permanece intacto na VPS** com:
- Credencial em plaintext (`WHATSAPP_API_KEY`).
- Server.js antigo (sem `hashPhone`).
- Logs ativos crescendo (54MB e contando).
- `.git` próprio.

Adicionalmente, o `LOG_FILE` no código novo aponta para o path antigo, então o `logrotate` configurado durante o Bloco H **nunca executa** (path errado).

---

## 1. Achados de Segurança (P0)

### P0-W1 — `WHATSAPP_API_KEY` em plaintext no ecosystem antigo
- **Arquivo:** `/home/sidney/eidosform-whatsapp/ecosystem.config.js` linha 5-8
- **Evidência:**
  ```js
  env: {
    WHATSAPP_API_KEY: 'd740b16263d6e361d169d5a9b0a7c714054160f069756eff60456ee20b8d6d76',
    PORT: '3457',
  },
  ```
- **Risco:** chave ainda válida (igual à do `.env` em uso na VPS — confirmado: `d740b16...`). Quem tiver acesso à VPS pega a chave em texto puro de duas fontes. Se esse `.git/` foi pushed em algum repo remoto público/privado mal configurado, está vazado.
- **Sugestão:** rotacionar a chave + remover ecosystem antigo + verificar histórico git do repo legado para limpar a chave do passado.

### P0-W2 — Server.js antigo sem `hashPhone` ainda no filesystem
- **Arquivo:** `/home/sidney/eidosform-whatsapp/server.js` (data 2026-04-14)
- **Risco:** se PM2 (ou qualquer supervisor humano/script) for reapontado para esse path, **logs voltam a vazar PII** (telefones em texto puro). É o exato bug que H1 corrigiu — mas pelo binário antigo continuar vivo, a correção é frágil.
- **Sugestão:** remover diretório legado por completo após confirmar nenhuma referência ativa.

---

## 2. Achados Operacionais (P1)

### P1-W1 — `LOG_FILE` no monorepo aponta para path antigo
- **Arquivo:** `services/whatsapp/server.js` linha 15
- **Evidência:**
  ```js
  const LOG_FILE = '/home/sidney/eidosform-whatsapp/server.log';
  ```
- **Consequência em cadeia:**
  - O server (rodando do monorepo) grava em `/home/sidney/eidosform-whatsapp/server.log` (54MB, crescendo agora — confirmado por `ls -lh`).
  - O logrotate `/etc/logrotate.d/eidosform-whatsapp` aponta para `/home/sidney/eidosform/services/whatsapp/server.log` (path novo, **vazio** — só `error.log` e `out.log` do pm2 existem).
  - Resultado: **logs do app crescem ilimitadamente sem rotação**.
- **Sugestão:** trocar `LOG_FILE` para path do monorepo (`./server.log` relativo ou caminho absoluto consistente) e atualizar logrotate se necessário.

### P1-W2 — Diretório `/home/sidney/eidosform-whatsapp/` permanece com 149MB
- **Conteúdo:** `.env` próprio (chave duplicada), `.git/`, `node_modules/` (~85MB), `server.log` (54MB, ativo), `latest-qr.png/.txt`, `status.json`, server.js antigo, ecosystem antigo, scripts.
- **Risco:** confusão operacional, vetor de exposição (P0-W1), espaço em disco.
- **Sugestão:** após validar que nada referencia mais, **arquivar/deletar** completamente.

### P1-W3 — `phone_number: phoneNumber || 'unknown'` em logs DB
- **Arquivo:** `lib/integration-stubs.ts` linha 109
- **Evidência:**
  ```ts
  phone_number: phoneNumber || 'unknown',
  ```
- **Consequência:** quando `leadData.phone` está vazio (form sem campo `phone`/`telefone`/`whatsapp` ou usuário não preencheu), grava literal `'unknown'` na coluna `phone_number`. **Explica o `unknown` que o Sidney viu no admin** ([print do admin/whatsapp](app/(dashboard)/admin/whatsapp)).
- **Sugestão:** se o phone está ausente, **não enviar** WhatsApp (não tem destinatário); ou armazenar `null` em vez de `'unknown'` para distinguir de testes.

### P1-W4 — `phone_number` armazenado em **texto puro** na tabela
- **Arquivo:** `lib/integration-stubs.ts` linha 109 + schema `supabase/migrations/20260405_whatsapp_logs.sql` linha 6
- **Evidência:** `phone_number text not null`
- **Consequência:** PII em texto puro no banco de dados. Backup do banco vaza telefones de leads.
- **Sugestão:** hashear ou tokenizar (mesmo padrão do `hashPhone` no server.js). Decisão de produto: precisa do telefone bruto pra auditoria do owner? Se sim, manter mas garantir RLS rígida (já tem). Se não, hashear.

---

## 3. Achados de UI/UX (P2)

### P2-W1 — Admin "Últimos envios" exibe valores confusos
- **Tela:** `/admin/whatsapp` (print do Sidney mostra entradas com `unknown` / `Formulário sem título`)
- **Causa do `unknown`:** P1-W3 (phone vazio).
- **Causa do `Formulário sem título`:** linha 52 de [app/api/admin/whatsapp/logs/route.ts](app/api/admin/whatsapp/logs/route.ts):
  ```ts
  formsById = new Map((forms ?? []).map((form) => [form.id, form.title || 'Formulário sem título']))
  ```
  Form existe mas tem título vazio. Confirmar via SQL: `select id, title from forms where title is null or title = ''`.
- **Sugestão:**
  - Mostrar ID parcial do form quando título é vazio: `'Form #' + form.id.slice(0, 8)`.
  - Para `unknown` recipient: mostrar "Sem telefone" + cor cinza.

### P2-W2 — Hardcoded fallbacks de URL em rotas admin
- **Arquivos:** [app/api/admin/whatsapp/status/route.ts](app/api/admin/whatsapp/status/route.ts), `disconnect/route.ts`, `qr/route.ts`
- **Evidência:**
  ```ts
  const base = process.env.WHATSAPP_API_URL || 'https://wpp.eidosform.com.br'
  ```
  Triplicado. Se URL mudar, há 3 lugares pra editar.
- **Sugestão:** extrair `getWhatsappBase()` em `lib/whatsapp-client.ts` (já existe `lib/whatsapp.ts` que pode receber esse helper).

### P2-W3 — `app/api/whatsapp/send/route.ts:81` usa fallback de localhost diferente das outras rotas
- **Evidência:** `process.env.WHATSAPP_API_URL || 'http://localhost:3456'` (porta 3456, não 3457)
- **Risco:** dev local pode funcionar fora do esperado se `WHATSAPP_API_URL` não estiver setado.
- **Sugestão:** padronizar fallback (porta 3457 — a real usada na VPS) ou remover fallback (forçar erro se env não existir).

---

## 4. Achados de Higiene (P3)

### P3-W1 — Scripts `fix-nginx-timeout.sh` e `restart-whatsapp-server.sh` duplicados
- **Onde:** existem em ambos os diretórios (`/home/sidney/eidosform-whatsapp/` e `services/whatsapp/`).
- **Risco:** baixo. Higiene.
- **Sugestão:** após cleanup do antigo, sumirá naturalmente.

### P3-W2 — Documentação refere paths antigos
- **Arquivos:** vários `.md` no repo (auditoria-uso-fase1.md, briefing-whatsapp-msgid-perdido.md, plano-execucao-correcoes-auditoria.md, etc).
- **Risco:** zero (são docs históricos). Não rotular como bug, só como contexto.
- **Sugestão:** deixar como histórico; novos docs já usam `services/whatsapp/`.

---

## 5. Estado das pastas (visão consolidada)

| Item | Path antigo | Path novo | Status |
|---|---|---|---|
| `server.js` | `/home/sidney/eidosform-whatsapp/server.js` | `services/whatsapp/server.js` | ⚠️ Antigo ainda existe (sem hashPhone) |
| `.env` | `/home/sidney/eidosform-whatsapp/.env` | `services/whatsapp/.env` | ⚠️ Duplicado, mesmo conteúdo |
| `ecosystem.config.js` | `/home/sidney/eidosform-whatsapp/ecosystem.config.js` | `services/whatsapp/ecosystem.config.js` | 🚨 Antigo tem KEY em plaintext |
| `nginx-updated.conf` | antigo: sem H2 headers | novo: com H2 headers | ✅ Novo é o ativo |
| `server.log` | antigo: 54MB ativo | novo: vazio | ⚠️ Crescendo sem rotação |
| `package.json` / `node_modules/` | duplicado (~85MB cada) | duplicado | ⚠️ 170MB de espaço duplicado |
| `logrotate` | aponta path **novo** (vazio) | — | ⚠️ Logrotate não roda (path errado) |
| `pm2 dump` | aponta path **novo** | — | ✅ OK (corrigido durante deploy) |
| `nginx /etc/nginx/sites-enabled/eidosform-whatsapp-api` | proxy_pass `127.0.0.1:3457` | — | ✅ OK (não muda) |
| `DNS wpp.eidosform.com.br` | A → 187.77.225.83 | — | ✅ OK |
| `SSL cert` | válido até 2026-07-06 | — | ✅ OK |

---

## 6. Top 11 prioridades

| # | ID | Sev | Resumo | Esforço |
|---|---|---|---|---|
| 1 | P0-W1 | P0 | Rotacionar `WHATSAPP_API_KEY` (chave em plaintext no ecosystem antigo) | 30 min |
| 2 | P0-W2 | P0 | Remover server.js antigo (sem hashPhone) | 5 min após cleanup |
| 3 | P1-W1 | P1 | Corrigir `LOG_FILE` em `services/whatsapp/server.js:15` | 5 min |
| 4 | P1-W2 | P1 | Limpar `/home/sidney/eidosform-whatsapp/` por completo | 15 min (com backup) |
| 5 | P1-W3 | P1 | Não enviar WhatsApp se `phone` ausente (substituir lógica `'unknown'`) | 20 min |
| 6 | P1-W4 | P1 | Avaliar hashear `phone_number` no DB (decisão de produto) | depende |
| 7 | P2-W1 | P2 | UI: melhorar copy "Formulário sem título" e "unknown" no admin | 20 min |
| 8 | P2-W2 | P2 | Extrair `getWhatsappBase()` helper único | 30 min |
| 9 | P2-W3 | P2 | Padronizar fallback de porta (3457 não 3456) | 5 min |
| 10 | P3-W1 | P3 | Scripts duplicados (some com cleanup) | grátis |
| 11 | P3-W2 | P3 | Docs com path antigo (não bug) | grátis |

---

## 7. Próxima auditoria sugerida

- **Fase 2 dinâmica:** rodar `wacli` em modo verbose por 1h e capturar todos os campos de output JSON para validar `messageId` extraction (problema do briefing-whatsapp-msgid-perdido.md ainda em aberto).
- **Penetration test:** tentar enviar WhatsApp via `WHATSAPP_API_URL` direto (bypass do `/api/whatsapp/send`) — confirmar que IP allowlist (P0-N2 da Fase 1 que ainda está aberto?) bloqueia.

---

## 8. Apêndice — Arquivos consultados

**Código:**
- `services/whatsapp/server.js`, `package.json`, `ecosystem.config.js`, `nginx-updated.conf`, `nginx.conf`
- `lib/integration-stubs.ts`, `lib/whatsapp.ts`, `lib/resend.ts`
- `app/api/whatsapp/send/route.ts`, `settings/route.ts`
- `app/api/admin/whatsapp/{status,disconnect,qr,logs}/route.ts`
- `supabase/migrations/20260405_whatsapp_logs.sql`, `20260430_fix_security_definer_public_access_whatsapp_logs.sql`

**Sistema:**
- `/home/sidney/eidosform-whatsapp/` (legado completo)
- `/home/sidney/.pm2/dump.pm2`
- `/etc/nginx/sites-enabled/eidosform-whatsapp-api`
- `/etc/logrotate.d/eidosform-whatsapp`
- DNS `wpp.eidosform.com.br`
- SSL cert `/etc/letsencrypt/live/wpp.eidosform.com.br/`
- `/var/log/nginx/access.log`

**Docs históricos:**
- `auditoria-uso-fase1.md`, `auditoria-uso-fase2.md`, `briefing-whatsapp-msgid-perdido.md`, `plano-execucao-correcoes-auditoria.md`, `relatorio-correcoes-auditoria.md`
