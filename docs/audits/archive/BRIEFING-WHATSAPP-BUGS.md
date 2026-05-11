# Briefing: Bugs WhatsApp EidosForm — 05/05/2026

## Referência: código que funcionava
Último commit confirmado funcionando: **`6d527b8` (09/abril/2026 19:22)**

## Arquitetura do Fluxo WhatsApp

```
Formulário preenchido
  → POST /api/responses (route.ts)
    → sendWhatsAppOnFormResponse() (lib/integration-stubs.ts)
      → POST /api/whatsapp/send (app/api/whatsapp/send/route.ts)
        → handleFormAwareSend()
          → busca settings no Supabase (form_whatsapp_settings)
          → buildMessage(settings.message_template, leadData)
          → sendViaVps(owner_phone, message)
            → POST http://localhost:3457/api/whatsapp/send (services/whatsapp/server.js)
              → wacli send (CLI)
```

### Componentes
1. **`lib/integration-stubs.ts`** — Monta `leadData` a partir das respostas do formulário e chama `/api/whatsapp/send`
2. **`app/api/whatsapp/send/route.ts`** — Recebe `{ formId, leadData }`, busca settings, substitui template, envia pra VPS
3. **`app/api/form/[id]/whatsapp/test/route.ts`** — Botão "Enviar teste" no painel admin
4. **`services/whatsapp/server.js`** — Servidor Fastify na VPS (porta 3457), usa `wacli` pra enviar mensagens

---

## BUG 1: Variáveis do template não substituídas ({nome} vira "Lead")

### Problema
Quando alguém preenche um formulário, a mensagem WhatsApp chega com `{nome}` substituído por **"Lead"** em vez do nome real do respondente.

### Causa
O `responseData` do formulário usa **UUIDs das perguntas** como chaves, não nomes amigáveis:

```javascript
// Exemplo real de responseData:
{
  "a1b2c3d4-e5f6-7890-abcd-ef1234567890": "João Silva",
  "f7e6d5c4-b3a2-1098-7654-321fedcba098": "joao@email.com"
}
// NÃO é: { "nome": "João Silva", "email": "joao@email.com" }
```

O código atual (`d45f831`) faz:
```javascript
const leadData = {
  name: String(responseData.nome || responseData.name || 'Lead'),  // undefined → "Lead"
  ...
}
```

Como `responseData.nome` e `responseData.name` não existem (são UUIDs), sempre cai em "Lead".

### Código que funcionava (commit `6d527b8`)
O commit `b5782b9` (09/abril 18:20) adicionou o mapeamento UUID→label:

```javascript
// Map question IDs to titles for readable data
const questionsMap = new Map<string, string>()
if (params.form.questions) {
  for (const q of params.form.questions) {
    if (q.id && q.title) questionsMap.set(q.id, q.title.toLowerCase().trim())
  }
}

// Build lead data by matching answer keys to question titles
const mappedAnswers: Record<string, string> = {}
for (const [key, value] of Object.entries(responseData)) {
  const label = questionsMap.get(key) || key
  mappedAnswers[label] = String(value ?? '')
}

// Find name, email, phone by scanning question titles
const findByLabel = (...labels: string[]): string => {
  for (const label of labels) {
    for (const [key, val] of Object.entries(mappedAnswers)) {
      if (key.includes(label)) return val
    }
  }
  return ''
}

const leadData = {
  name: findByLabel('nome', 'name', 'nome completo') || 'Lead',
  email: findByLabel('email', 'e-mail') || 'N/A',
  phone: findByLabel('telefone', 'phone', 'celular', 'whatsapp') || '',
  ...
}
```

Isso mapeia UUID → título da pergunta (ex: "nome", "email"), depois busca pelo label.

### Solução
Restaurar o bloco de mapeamento UUID→label do commit `6d527b8` em `lib/integration-stubs.ts`.

### Arquivo a alterar
- `lib/integration-stubs.ts` — restaurar `questionsMap` + `findByLabel` + `mappedAnswers`

---

## BUG 2: Botão "Enviar teste" mandava template substituído (reverter)

### Problema
O commit `d45f831` alterou o botão de teste pra usar `handleFormAwareSend` com dados fictícios. Isso faz o teste enviar dados falsos ("João Silva (Teste)") em vez dos placeholders crus.

### Comportamento correto
O botão de teste é **apenas teste de conectividade**. Deve mandar o template cru com `{form_name}`, `{nome}`, etc. sem substituir.

### Código original (commit `8b9dbf9`)
```javascript
body: JSON.stringify({
  to: owner_phone,
  message: message_template,  // template cru, sem substituição
}),
```

### Código atual (bugado, commit `d45f831`)
```javascript
const testLeadData = {
  name: 'João Silva (Teste)',
  email: 'joao@teste.com',
  ...
}
body: JSON.stringify({
  formId: id,
  leadData: testLeadData,
}),
```

### Solução
Reverter `app/api/form/[id]/whatsapp/test/route.ts` ao comportamento original (direct send com template cru).

### Arquivo a alterar
- `app/api/form/[id]/whatsapp/test/route.ts` — reverter ao direct send

---

## BUG 3: Mensagem duplicada por submissão

### Problema
Ao preencher e submeter um formulário, chegam **2 mensagens WhatsApp** idênticas.

### Investigação
- `sendWhatsAppOnFormResponse` só é chamado **1 vez** em `app/api/responses/route.ts` (linha 385)
- Não há outro lugar no código server-side chamando WhatsApp
- Hipóteses:
  1. O client-side (form-player) está enviando o POST 2x (duplo click, autosave trigger, ou falta de debounce)
  2. O `Promise.allSettled` no responses route pode estar executando a promise 2x em algum edge case
  3. O autosave (`PATCH`) pode estar interferindo com o submit (`POST`)

### Onde investigar
- `components/form-player/form-player.tsx` — verificar se `handleSubmit` dispara 1 ou 2 vezes
- Verificar autosave não interfere no fluxo de submit
- Checar Vercel logs se chegam 2 POSTs em `/api/responses` por submissão

### Arquivos a investigar
- `components/form-player/form-player.tsx`
- `app/api/responses/route.ts`

---

## Estado dos arquivos (commit atual: `d45f831`)

| Arquivo | Estado |
|---------|--------|
| `lib/integration-stubs.ts` | **BUGADO** — sem mapeamento UUID→label, sem gate de telefone |
| `app/api/form/[id]/whatsapp/test/route.ts` | **BUGADO** — usa form-aware send com dados falsos |
| `app/api/whatsapp/send/route.ts` | OK |
| `app/api/responses/route.ts` | Provável fonte da duplicação |
| `services/whatsapp/server.js` | OK — VPS online e autenticado |

## Infraestrutura (resolvido hoje)
- PM2 do root em conflito com PM2 do sidney → **resolvido** (`sudo pm2 delete all` no root)
- wacli store locked por zombie → **resolvido** (`pkill -9 -f wacli; rm -f ~/.wacli/*.lock`)
- Serviço WhatsApp online: `authenticated=true connected=true` na porta 3457

## Instruções de correção
1. Restaurar `lib/integration-stubs.ts` ao estado do commit `6d527b8` (com questionsMap + findByLabel, sem phone gate)
2. Reverter `app/api/form/[id]/whatsapp/test/route.ts` ao direct send original
3. Investigar e corrigir duplicação em `form-player.tsx` ou `responses/route.ts`
4. Commit, push, aguardar deploy Vercel Ready
5. Testar: submissão real + botão de teste
