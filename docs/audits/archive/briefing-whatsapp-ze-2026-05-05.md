# Briefing — Auditoria WhatsApp (para Zé / OpenClaw)

**Data:** 2026-05-05
**Solicitado por:** Sidney
**Autor:** Claude Code (sessão de auditoria)
**Repo:** `/home/sidney/eidosform/`
**Branch:** `main`
**Último commit:** `dfd3e10 fix(admin/whatsapp): keep polling status when QR expires after pairing`

---

## TL;DR

A integração de notificação por WhatsApp está **quebrada em produção** desde a sessão de hoje. **Antes funcionava** (Sidney confirmou). A entrega final no celular está em "Aguardando mensagem" mesmo quando consegue chegar; testes recentes nem disparam o envio. Suspeita-se de:

1. **Bug bloqueador no caminho de disparo** (`lib/integration-stubs.ts:62-65`): a função aborta o envio quando o lead não preencheu telefone, mas o destinatário da notificação é o **dono do form** (`owner_phone`), não o lead. Esse filtro é incorreto e provavelmente é o motivo de **nenhum log aparecer no serviço VPS** nos testes mais recentes.

2. **Template `{form_name}` / `{nome}` não interpolado** nas mensagens que Sidney recebeu antes do wipe. O `buildMessage()` em `app/api/whatsapp/send/route.ts:61-79` faz a substituição, mas as chaves esperadas (`form_name`, `name`/`nome`) não estão sendo populadas em `leadData` corretamente para esse fluxo. Pode haver mismatch entre as labels do form e as labels esperadas pelo `findByLabel()` em `lib/integration-stubs.ts:41-48`.

3. **"Aguardando mensagem" no celular** é um sintoma de problema **mais profundo** (whatsmeow/wacli) que **não é resolvível** com lógica de aplicação. Mexi muito nessa camada hoje (daemon + queue + redelivery) e não atingi solução estável. **Recomendo migrar para Evolution API** como solução definitiva.

---

## Sintomas observados (cronologia)

| Hora (BRT) | Sintoma | Reproduzido por |
|---|---|---|
| ~07:30 | Toggle "Ativar Notificações WhatsApp" no builder retornava 500 | Sidney clicou no toggle antes de digitar número |
| ~07:50 | Status do admin ficava em "Autenticando…" eternamente | Sidney na UI |
| ~08:06 | Mensagens chegando no WhatsApp Web com `{form_name}: {nome} oi` literais | Sidney respondeu o form de teste |
| ~08:10 | Mesmas mensagens no celular como "Aguardando mensagem" | Sidney verificou aparelho |
| ~08:15 | Loop de redelivery (~8 mensagens repetidas) — só parou quando o destinatário respondeu | Sidney testou após meu fix #1 |
| ~09:25 (após wipe + re-pareamento) | Resposta no form **não disparou** o serviço WhatsApp — log do VPS não tem nenhum `[send]` | Sidney testou |

---

## Caminho funcional esperado (ponta-a-ponta)

```
[Form player no /f/<slug>] 
     │ submit response
     ▼
[POST /api/responses (Vercel)]   ← app/api/responses/route.ts
     │ persist response no Supabase
     │ disparar fire-and-forget:
     ▼
[sendWhatsAppOnFormResponse]     ← lib/integration-stubs.ts
     │ monta leadData a partir do form + answers
     │ chama com Bearer INTERNAL_API_SECRET:
     ▼
[POST /api/whatsapp/send (Vercel)] ← app/api/whatsapp/send/route.ts
     │ getWhatsAppSettings(formId) → owner_phone, message_template, enabled
     │ checa plano (Plus+), rate limit
     │ buildMessage(template, leadData) → substitui {nome}, {form_name}, etc.
     │ chama VPS:
     ▼
[POST http://VPS:3457/api/whatsapp/send (Fastify)]  ← services/whatsapp/server.js
     │ valida Bearer WHATSAPP_API_KEY/INTERNAL_API_SECRET
     │ withDaemonPaused(() => doWacliSend(phone, message))
     │ exec wacli send text --to ... --message ... --json
     │ daemon volta após 1s
     ▼
[wacli — whatsmeow] → Meta WhatsApp servers → telefone do dono do form
```

**Onde a auditoria deve focar:**

- `lib/integration-stubs.ts` — está cortando o disparo cedo demais
- `app/api/whatsapp/send/route.ts` (`handleFormAwareSend`) — está interpolando o template com `leadData` que pode estar incompleto
- `services/whatsapp/server.js` — sofreu **muitas mudanças hoje** (daemon, queue, redelivery, watchdog). Possível introdução de regressões.

---

## Bug bloqueador #1 — Filtro indevido em `lib/integration-stubs.ts`

**Local:** `lib/integration-stubs.ts:62-65`

```ts
if (!leadData.phone || leadData.phone.trim().length === 0) {
  log('[WhatsApp] No phone captured in response, skipping send', { formId, responseId })
  return
}
```

**Problema:** Esse filtro impede o disparo quando o **lead** não tem telefone. Mas a notificação WhatsApp é enviada para o **dono do form** (`form_whatsapp_settings.owner_phone`), não para o lead. Logo, esse filtro está bloqueando notificações em qualquer formulário que não tenha campo de telefone obrigatório (ou onde o lead deixou em branco).

**Sidney confirmou:** o form de teste **não tem** pergunta de telefone. Isso explica por que o último teste (após o wipe + re-pareamento bem-sucedido) **não gerou nenhum log no serviço VPS** — o disparo morreu logo na entrada da função.

**Correção sugerida:** remover o filtro, ou no mínimo movê-lo para **depois** da chamada à `/api/whatsapp/send` (que tem a lógica correta de validar `owner_phone`, não `lead.phone`).

**Fix proposto (1 linha removida):**

```ts
// REMOVE:
if (!leadData.phone || leadData.phone.trim().length === 0) {
  log('[WhatsApp] No phone captured in response, skipping send', { formId, responseId })
  return
}
```

---

## Bug bloqueador #2 — Template não interpolado

**Local:** `app/api/whatsapp/send/route.ts:61-79` (`buildMessage`) + `lib/integration-stubs.ts:50-59` (montagem de `leadData`)

**Sintoma:** mensagens chegavam literalmente com `{form_name}` e `{nome}`. Isso ocorre quando `buildMessage()` recebe um `leadData` que não tem essas chaves (ou tem com valores vazios mas o template usa `||` para fallback).

**Investigação necessária:**

- O `findByLabel('nome', 'name', 'nome completo')` em `lib/integration-stubs.ts:51` busca por **substring** nas labels (lowercased) das perguntas. Se o form de teste tinha pergunta "Qual seu nome?", o título lowercased é `qual seu nome?` — `includes('nome')` retorna `true` ✅
- Mas se a pergunta era simplesmente "Pergunta 1" (sem a palavra "nome"), `findByLabel` retorna string vazia → `leadData.name = 'Lead'` (fallback)
- O `buildMessage` substitui `{nome}` por `String(leadData.name || leadData.nome || 'Lead')` → resultado: `Lead`. **Não literal `{nome}`**.

**Conclusão:** o sintoma do `{nome}` literal indica que **o `buildMessage` não foi executado** — ou seja, a chamada não chegou em `/api/whatsapp/send`, ou foi roteada para outro caminho. Suspeita: pode ter sido enviada via `/api/whatsapp/send` em **modo direto** (`{ to, message }`) onde o `message` já vem com placeholders sem interpolação.

**Quem chama em modo direto?**
- `app/api/form/[id]/whatsapp/test/route.ts:131-141` — passa `message: message_template` **sem interpolação**.
- Sidney pode ter testado pelo botão "Enviar mensagem de teste" do builder, em vez de submeter resposta real.

**Auditar:** se Sidney usa o botão de teste do builder, deveria ter um `buildMessage` aplicado lá também (com leadData mockado para preview). Hoje envia o template cru.

---

## Mudanças aplicadas em `services/whatsapp/server.js` nesta sessão

Resumo dos commits recentes (mais novo no topo):

| Commit | O que faz | Risco |
|---|---|---|
| `dfd3e10` | Polling no admin não para quando QR expira | Baixo — UI |
| `f76a113` | Capa redelivery para evitar loop infinito | Médio — lógica de retry |
| `c253c9d` | Redelivery on retry receipt (cache em memória + parser stdout) | **Alto** — adiciona ~80 LOC, parsing frágil de log |
| `9c587b9` | `connected=true` quando daemon vivo (override do `wacli doctor`) | Médio — semântica de status mudou |
| `cd9d629` | Spawn daemon após QR auth + watchdog em refreshStatus | Médio |
| `6be6f3d` | Daemon + queue (+126 LOC) — `wacli sync --follow` em background, send pausa daemon, restart 1s depois | **Alto** — mudança arquitetural |
| `d11d67e` | Stop wacli auth auto-respawn (lock conflict) | Baixo — fix focado |
| `46646ec` | Botão "Disconnect & re-pair" na UI quando autenticando | Baixo — UI |
| `bc58b43` | `owner_phone` nullable + connected status accurate | Baixo |
| `26a9a85` | Carrega `.env` via `dotenv` (PM2 `env_file` é no-op) | Baixo |

**Áreas que entraram nesta sessão e merecem revisão crítica:**

1. **Daemon + queue** (`6be6f3d`) — premissa: manter `wacli sync --follow` rodando para preservar ratchet keys. Funcionou parcialmente: os sends ainda fazem ratchet drift em alguns casos. **Pode ser revertido se a Evolution API for adotada.**

2. **Redelivery** (`c253c9d` + `f76a113`) — lê stdout do daemon procurando "Failed to handle retry receipt for ... <msgId>" e re-envia. **Provoca loop quando o destinatário nunca consegue decifrar.** Capado em 2 retries totais agora, mas o cap é frágil — depende de carregar contador entre msgIds da cadeia. **Considerar remover.**

3. **Status `connected` agora considera daemon vivo** (`9c587b9`) — antes era apenas `wacli doctor`. Funciona, mas pode mascarar problemas reais (daemon vivo mas socket morto).

---

## Estado da entrega no celular ("Aguardando mensagem")

Esse é o sintoma mais persistente. Hipóteses já testadas:

| Hipótese | Status |
|---|---|
| Sessão wacli corrompida pré-existente | **Refutada** — wipe completo + re-pareamento limpo, mesmo sintoma |
| Daemon não rodando entre sends | **Refutada** — daemon vivo reportando `Connected.` |
| Pre-keys do destinatário desatualizadas | **Provável** — wacli não expõe forma de refresh |
| Cliente WhatsApp do destinatário com sessão velha | Parcialmente — Sidney respondeu uma vez e fluxo se estabilizou momentaneamente |
| Identity key do sender mudou sem notificação ao destinatário | **Possível** — re-pareamento gera nova identity |

**Conclusão:** com o stack atual (wacli/whatsmeow + processos single-shot), a "Aguardando mensagem" é estrutural. **Caminho 2 — migrar para Evolution API** é a recomendação técnica de quem está mais próximo do código.

`docs/evolution-setup.md` já existe no repo. Possivelmente havia tentativa anterior abortada. Auditar.

---

## Estado de artefatos

### Migrations
- `supabase/migrations/20260505_form_whatsapp_settings_nullable_phone.sql` — **NÃO aplicado em produção ainda.** Sidney precisa rodar no Supabase Studio. Já aplicado no schema local? **Não verificado.**
- `supabase/migrations/20260504_normalize_whatsapp_unknown_phones.sql` — Aplicado por Sidney.

### Variáveis de ambiente
- VPS: `/home/sidney/eidosform/services/whatsapp/.env` (chmod 600) — contém `WHATSAPP_API_KEY`, `INTERNAL_API_SECRET`, `PORT=3457`.
- Vercel: `INTERNAL_API_SECRET`, `WHATSAPP_API_KEY` — **rotacionados em produção** após exposição em `ecosystem.config.js` legado. Não rotacionados em preview/development. Auditar.
- `lib/whatsapp-client.ts` — abstração nova (`getWhatsappBase()`, `getWhatsappUrl()`, `getWhatsappAuthHeaders()`).

### PM2 na VPS
- Daemon do `sidney`: `eidosform-whatsapp` (PID atual ~405212), online.
- Daemon do `root`: existe (`/root/.pm2`) mas vazio. Pode ser deletado por garantia.
- Logs: `/home/sidney/eidosform/services/whatsapp/server.log`, `logs/error.log`, `logs/out.log`.

### Backup do store wacli (pré-wipe)
- `/home/sidney/.wacli-backup/wipe-2026-05-05/` — preserva session.db + wacli.db da sessão antiga. Pode descartar quando confirmar que tudo está estável.

---

## Pontos de auditoria recomendados (ordem de prioridade)

### P0 — Restaurar entrega básica
1. **Remover** o filtro `if (!leadData.phone)` em `lib/integration-stubs.ts:62-65`. Validar que envio dispara para forms sem telefone do lead.
2. **Refazer teste end-to-end** com form sem campo de telefone + owner_phone configurado. Confirmar que log `[send]` aparece em `/home/sidney/eidosform/services/whatsapp/server.log`.

### P1 — Corrigir interpolação
3. Auditar como o painel de teste (`/api/form/[id]/whatsapp/test`) monta a mensagem — passa template cru, deveria passar via `buildMessage` com `leadData` mockado.
4. Adicionar log/observabilidade em `buildMessage` para flagar quando placeholders escapam (ex: regex `/\{[a-z_]+\}/` no resultado pós-substituição).

### P2 — Estabilidade da camada wacli
5. Avaliar reverter os 3 commits mais arriscados desta sessão (`c253c9d` redelivery, `f76a113` cap, `6be6f3d` daemon+queue) e voltar para single-shot puro. Aceita-se "Aguardando mensagem" ocasional como tradeoff até a Evolution API entrar.
6. Decisão: **manter wacli + redesign** OU **migrar para Evolution API** (`docs/evolution-setup.md`).

### P3 — Higiene
7. Aplicar a migration `20260505_form_whatsapp_settings_nullable_phone.sql` no Supabase de produção.
8. Rotacionar `WHATSAPP_API_KEY` em preview/development da Vercel (só prod foi rotacionado).
9. Deletar daemon PM2 do root (`/root/.pm2`) — vazio mas redundante.

---

## Como reproduzir o cenário

1. Ter o painel admin → status "Conectado" com número WhatsApp.
2. Abrir um form que **não tem** pergunta de telefone, com `form_whatsapp_settings.enabled=true` e `owner_phone` preenchido.
3. Submeter resposta no `/f/<slug>`.
4. Observar logs do VPS: `tail -f /home/sidney/eidosform/services/whatsapp/server.log`.
5. **Esperado:** linha `[send] Success: <hash> (msgId: ...)`.
6. **Atual:** nenhum log de `[send]`. Disparo morre em `lib/integration-stubs.ts:62-65`.

---

## Apêndice — arquivos relevantes para auditar

- `lib/integration-stubs.ts` — disparo após response
- `app/api/whatsapp/send/route.ts` — orquestração + buildMessage + chamada VPS
- `app/api/forms/[id]/whatsapp/route.ts` — settings GET/POST
- `app/api/form/[id]/whatsapp/test/route.ts` — botão de teste do builder
- `services/whatsapp/server.js` — Fastify + wacli daemon/queue/redelivery
- `services/whatsapp/.env` — chaves (chmod 600)
- `lib/whatsapp.ts` — `getWhatsAppSettings`
- `lib/whatsapp-client.ts` — VPS URL/auth helpers
- `lib/types/whatsapp.ts` — tipos
- `components/admin/admin-whatsapp-panel.tsx` — UI do admin
- `components/form-builder/whatsapp-settings.tsx` (se existir) — UI do builder
- `supabase/migrations/20260505_form_whatsapp_settings_nullable_phone.sql` — migration pendente

---

## Histórico desta sessão (logs/comandos importantes)

- Backup pré-wipe: `/home/sidney/.wacli-backup/wipe-2026-05-05/`
- Logs do serviço: `/home/sidney/eidosform/services/whatsapp/server.log` (~7400 linhas)
- Re-pareamento bem-sucedido: 2026-05-05T12:20:22Z (`[daemon] stderr: Connected.`)
- Status atual do serviço: `authenticated=true connected=true phone=d8119a4c` (hash de `+55 83 9911-XXXX`)
