# BRIEFING — WhatsApp `msgId: N/A` no log de envio

> Criado em: 2026-05-04
> Status: pendência cosmética / telemetria perdida (NÃO é bug funcional)
> Severidade: P3
> Autor do briefing: Claude Code (Opus 4.7) a pedido do Sidney

---

## 1. Sintoma

No painel da Vercel, o log do envio de WhatsApp aparece assim (forma antiga, antes do commit `48c859b`):

```
[2026-05-04T20:33:53.628Z] WARN: [WhatsApp] ✅ Sent for form 006a24f3-7871-4ed7-bd61-a160fe3736b4,
response 32f2e002-ed0c-4a1d-b0b5-a36f4322b273, msgId: N/A undefined
```

Três coisas erradas no mesmo log:

1. **Severidade WARN para evento de sucesso** — distorce qualquer alerta/filtro baseado em severidade. *(corrigido em `48c859b`)*
2. **Trailing `undefined`** — `logWarn` em `lib/logger.ts:50` sempre concatena o segundo argumento; nesse log nada foi passado. *(corrigido em `48c859b`)*
3. **`msgId: N/A`** — a resposta JSON do endpoint `/api/whatsapp/send` chegou no caller (`lib/integration-stubs.ts`) **sem o campo `messageId`** (ou com valor falsy). **Esta parte continua aberta — é o foco deste briefing.**

A funcionalidade está OK: a mensagem de WhatsApp **é entregue**. O problema é exclusivamente que o ID da mensagem se perdeu na cadeia, então não temos rastreabilidade fim-a-fim ("qual msgId do WhatsApp corresponde a qual `responseId`").

---

## 2. Cadeia do `messageId` (4 saltos)

### Salto 1 — `wacli` → `tryWacliSend()` na VPS
`services/whatsapp/server.js:228-263`

```js
const { stdout, stderr } = await execFileAsync(
  WACLI,
  ['send', 'text', '--to', phone, '--message', cleanMessage, '--json'],
  { timeout: 15000 }
);
const output = (stdout + stderr + '').trim();
const jsonMatch = output.match(/\{.*\}/s);
const result = JSON.parse(jsonMatch[0]);
return {
  success,
  messageId: result.data?.id,   // ← origem do messageId
  error: result.error
};
```

**Pontos de atenção:**
- Lê `result.data?.id`. Se o `wacli` não devolver esse campo no JSON (mudou de versão? versões antigas usam `result.id` na raiz?), vira `undefined`.
- O regex `/\{.*\}/s` pode pegar **um JSON intermediário** (não o final) se o stdout tiver múltiplos objetos JSON impressos sequencialmente. Greedy `.*` ajuda mas não é garantia.

### Salto 2 — VPS endpoint `/api/whatsapp/send` (server.js)
`services/whatsapp/server.js:324-339`

```js
const result = await sendWithFallback(to, message);
if (!result.success) { /* erro */ }
log(`[send] Success: ${to} (msgId: ${result.messageId})`);
return reply.send({ success: true, messageId: result.messageId });
```

Se `result.messageId === undefined`, o JSON serializado **omite a chave** (JSON.stringify pula campos undefined). A resposta vira literalmente `{ success: true }` sem `messageId`.

### Salto 3 — App Next, `sendViaVps()`
`app/api/whatsapp/send/route.ts:94-138`

```ts
const data = await response.json()
return { messageId: data.messageId ?? `vps-${Date.now()}` }
```

**Tem fallback** (`vps-${Date.now()}`) que **garante** retorno não-vazio. Se essa rota for executada, o `messageId` final NÃO pode ser undefined nem vazio.

### Salto 4 — App Next, endpoint `/api/whatsapp/send` (route.ts)
`app/api/whatsapp/send/route.ts:266-273` (form-aware path):

```ts
const result = await sendViaVps(settings.owner_phone, message)
return NextResponse.json({
  success: true,
  messageId: result.messageId,
  timestamp: new Date().toISOString(),
})
```

Aqui o `messageId` deveria ser sempre string não-vazia (`"vps-..."` no pior caso).

### Salto 5 — Caller, `integration-stubs.ts`
`lib/integration-stubs.ts:78-79` (forma já corrigida em `48c859b`):

```ts
const result = await sendResponse.json() as { success?: boolean; messageId?: string }
log('[WhatsApp] Sent', { formId, responseId, msgId: result.messageId ?? null })
```

---

## 3. Por que aparece `N/A` mesmo com fallback?

A cadeia tem **duas oportunidades de fallback** (saltos 1→3 e 3→5). O log mostrou `msgId: N/A`, ou seja, `result.messageId` falsy ao chegar no caller. Possibilidades:

### Hipótese A — Caminho alternativo sem fallback do salto 3 (mais provável)
Existe algum outro lugar que retorna `messageId: ... ` sem o fallback `vps-${Date.now()}`? Procurar:

```bash
grep -rn 'messageId' /home/sidney/eidosform/app/api/whatsapp/ /home/sidney/eidosform/lib/whatsapp*.ts
```

Suspeitos potenciais:
- Stub de teste/simulação que devolve `{ success: true }` sem messageId
- Branch de "rate-limited mas continua" que retorna ok sem id
- Cache hit que devolve resultado parcial

### Hipótese B — Mismatch de versão do wacli
O `wacli send --json` pode estar produzindo JSON com schema diferente do esperado em `services/whatsapp/server.js:257`. Versões testadas no audit anterior podem ter mudado.

**Como verificar (na VPS):**
```bash
ssh <vps>
wacli send text --to 5511999999999 --message "teste" --json
```
Conferir se a saída inclui `data.id` ou se mudou pra outro campo.

### Hipótese C — JSON parsing parcial
O regex `/\{.*\}/s` em `tryWacliSend` (`server.js:245`) é frágil:
- Se `wacli` imprime logs antes do JSON final, o regex captura tudo entre o primeiro `{` e o último `}` — pode pegar lixo no meio.
- Pior: se `wacli` imprime um JSON de progresso (`{ "progress": 0.5 }`) **antes** do JSON final, o `.*` greedy funciona, mas se a ordem inverter, captura o errado.

### Hipótese D — `wacli` retornando sucesso sem id
Algumas versões do `wacli`/Baileys podem confirmar entrega sem fornecer um message ID estável (especialmente em retransmissões de fallback de 8/9 dígitos em `sendWithFallback`, `server.js:265-291`). Nesse caso `result.data.id` nunca existe e cai no fallback `vps-${Date.now()}`.

**Mas se cair no fallback do salto 3, o caller deveria ver `vps-...`, não nada.** Então essa hipótese sozinha não explica o sintoma — ela combinada com a Hipótese A explica.

### Hipótese E — Bug serverless / cold start
Pouco provável, mas vale mencionar: se o `data` em `sendViaVps` for parseado de uma response com erro de stream em cold start, `data.messageId` pode vir undefined sem trigger do fallback (mas o `??` deveria pegar undefined).

---

## 4. Plano de investigação (passo-a-passo)

### Passo 1 — Confirmar que ainda acontece pós-fix do log (commit `48c859b`)
- Submeter resposta num form com WhatsApp ativo (conta Plus+).
- Olhar log novo na Vercel. Esperado: `[WhatsApp] Sent { formId, responseId, msgId: <valor> }`.
- Se `msgId` é `null` ou `"vps-<timestamp>"`, isolamos onde o ID se perdeu.

| Valor de `msgId` no log novo | O que indica |
|---|---|
| `null` | Endpoint `/api/whatsapp/send` retornou sem messageId — provavelmente caminho alternativo (Hip. A) |
| `"vps-<timestamp>"` | Veio do fallback do salto 3 — VPS não retornou id (Hip. B/C/D) |
| Valor real (ex: `3EB0..."`, `wamid....`) | Bug resolveu sozinho ou era timing antigo, fechar o caso |

### Passo 2 — Logar response na VPS pra confirmar Hipótese B/C/D
Na VPS, adicionar log temporário em `services/whatsapp/server.js` linha 254:

```js
log('[wacli result]', JSON.stringify(result));
```

Disparar 1 envio de teste e capturar `journalctl` ou o log do PM2/systemd da VPS. Comparar o JSON real do `wacli` com o esperado (`{ data: { id: "..." } }`).

### Passo 3 — Auditar paths alternativos no app (Hipótese A)
```bash
cd /home/sidney/eidosform
grep -rn 'messageId' app/api/whatsapp/ lib/whatsapp*.ts lib/integration-stubs.ts
```
Procurar qualquer função que retorne `messageId` sem o `?? \`vps-${Date.now()}\`` ou equivalente.

### Passo 4 — Inspeção pontual do payload na rota Next
Em `app/api/whatsapp/send/route.ts:268-273`, adicionar log temporário antes do return:

```ts
const result = await sendViaVps(settings.owner_phone, message)
console.log('[whatsapp/send] returning', { hasMessageId: Boolean(result.messageId), messageId: result.messageId })
return NextResponse.json({ ... })
```

Isso confirma se o messageId já está perdido **dentro do app** ou se some entre a serialização do app e o `await sendResponse.json()` no caller.

---

## 5. Sugestões de fix (em ordem de complexidade)

### Fix 1 — Defensivo no caller (5 min, sem deploy de VPS)
Em `lib/integration-stubs.ts` (após o atual), garantir que o log e o registro persistido sempre tenham um identificador válido — mesmo que sintético:

```ts
const msgId = result.messageId || `synth-${Date.now()}-${responseId.slice(0, 8)}`
log('[WhatsApp] Sent', { formId, responseId, msgId, msgIdSynthetic: !result.messageId })
logWhatsAppSend(formId, responseId, 'sent', msgId, null, leadData.phone).catch(() => {})
```

Pros: rastreabilidade local restaurada.
Contras: não resolve a causa raiz; usa ID sintético que não corresponde ao msgId real do WhatsApp.

### Fix 2 — Garantir fallback consistente no app (10 min)
Replicar o fallback de `sendViaVps` (linha 126) também no retorno do endpoint `/api/whatsapp/send` em `route.ts:271,312`:

```ts
return NextResponse.json({
  success: true,
  messageId: result.messageId || `vps-${Date.now()}`,  // ← duplicar fallback aqui também
  timestamp: new Date().toISOString(),
})
```

Pros: cobre o caso raro de `result.messageId` ser falsy mesmo após sendViaVps.
Contras: mascarar o sintoma; bug real fica escondido.

### Fix 3 — Resolver na origem, na VPS (30–60 min)
Após confirmar via Passo 2 qual campo o `wacli` está usando hoje:
- Atualizar `services/whatsapp/server.js:257` pra ler o campo correto, com fallbacks múltiplos:
  ```js
  messageId: result.data?.id ?? result.id ?? result.messageId ?? null,
  ```
- Considerar trocar o regex frágil por parsing linha-a-linha do stdout, lendo apenas a última linha JSON válida.

Pros: resolve causa raiz, ID real do WhatsApp preservado.
Contras: requer deploy/restart do servidor da VPS (`/home/sidney/eidosform/services/whatsapp/`).

### Fix 4 — Recomendado, combinação (1h)
**Fix 3 (origem) + Fix 1 (defensivo)**. Fix 3 resolve o caso normal; Fix 1 garante que mesmo se o `wacli` falhar em retornar id em algum cenário futuro, ainda temos rastreabilidade local não-nula no banco (`form_whatsapp_logs`).

---

## 6. O que NÃO investigar (já fechado)

- ✅ Severidade do log (já corrigido em `48c859b`).
- ✅ Trailing `undefined` no log (já corrigido em `48c859b`).
- ✅ Funcionalidade do envio de WhatsApp em si — está funcionando, o usuário recebe a mensagem.

---

## 7. Arquivos relevantes (referência rápida)

| Arquivo | Linhas | Papel |
|---|---|---|
| `services/whatsapp/server.js` | 228-263 | `tryWacliSend` — extrai messageId do output do `wacli` |
| `services/whatsapp/server.js` | 265-291 | `sendWithFallback` — tenta 8 e 9 dígitos antes de desistir |
| `services/whatsapp/server.js` | 324-339 | Endpoint POST `/api/whatsapp/send` da VPS |
| `app/api/whatsapp/send/route.ts` | 94-138 | `sendViaVps` no app Next, com fallback `vps-${Date.now()}` |
| `app/api/whatsapp/send/route.ts` | 266-285 | `handleFormResponse` — caminho usado pelo flow de submissão |
| `app/api/whatsapp/send/route.ts` | 308-325 | `handleDirectSend` — caminho legacy/internal |
| `lib/integration-stubs.ts` | 60-91 | `sendWhatsAppOnFormResponse` — caller a partir de `app/api/responses/route.ts` |
| `lib/logger.ts` | 29-51 | `log`, `logWarn`, `logError` — note que TODOS concatenam o 2º argumento, mesmo se for undefined |

---

## 8. Contexto adicional

- **Quem deve assumir:** Toin (frontend/integrations) ou Zeca (backend), via OpenClaw — não há urgência (P3).
- **Risco de não corrigir:** continuamos sem rastreabilidade fim-a-fim entre `responseId` e msgId real do WhatsApp. Se um cliente reportar "minha mensagem não chegou", não conseguimos cruzar com logs do WhatsApp Business pra validar.
- **Risco se piorar:** a mensagem em si **continua sendo entregue**. O bug é puramente de telemetria.
- **Quando reabrir prioridade:** se a base crescer e debug de entregas virar gargalo de suporte, subir pra P2.

---

**Assinatura:** Briefing redigido por Claude Code (Opus 4.7, 1M context) em 2026-05-04 a pedido do Sidney. Investigação parcial — análise estática + reprodução não executada (requer ambiente Vercel + VPS reais). Próximo investigador deve começar pelo Passo 1 da Seção 4.
