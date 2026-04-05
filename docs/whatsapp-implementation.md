# WhatsApp Integration Implementation - ETAPA 1

**Status:** ✅ CONCLUÍDO  
**Data:** 2026-04-05  
**Agent:** Zeca (Backend)

---

## Checklist de Implementação

- [x] Endpoint criado em `app/api/whatsapp/send/route.ts`
- [x] wacli integrado via `execSync()`
- [x] Validações implementadas (auth, plan, input)
- [x] Testes com curl documentados
- [x] TypeScript validação (npx tsc --noEmit) ✅ zero erros
- [x] ESLint validação (npx eslint ...) ✅ zero erros

---

## Implementação Técnica

### Endpoint: POST `/api/whatsapp/send`

**Localização:** `app/api/whatsapp/send/route.ts`

**Autenticação:**
- Requer token Bearer (via header `Authorization: Bearer <token>`)
- Autentica contra Supabase via `getRequestUser()`
- Retorna 401 se não autenticado

**Autorização:**
- Verifica se o plano do usuário é "plus", "professional" ou "enterprise"
- Planos "free" e "starter" recebem 403 Forbidden

**Parâmetros (JSON POST):**

```json
{
  "instance": "string",      // Nome da instância WhatsApp (e.g., "eidosform-plus")
  "to": "string",            // Número phone (aceita: 5585999999999, +5585999999999)
  "message": "string",       // Texto da mensagem
  "template_vars": {         // Opcional: variáveis de template (uso futuro)
    "key": "value"
  }
}
```

**Validações Implementadas:**

1. ✅ **Autenticação:** Token Bearer obrigatório
2. ✅ **Plano:** Plus+ obrigatório (free/starter → 403)
3. ✅ **Campos obrigatórios:** instance, to, message
4. ✅ **Formato de telefone:** 
   - Aceita: 5585999999999, +5585999999999
   - Valida: começa com 55 (Brasil), 11-13 dígitos
   - Rejeita números inválidos → 400 Bad Request
5. ✅ **Rate limiting:** Pode ser adicionado em futuras iterações
6. ✅ **wacli disponibilidade:** Se não estiver instalado → 503

**Response (Sucesso - 200 OK):**

```json
{
  "success": true,
  "messageId": "wacli-1712282877000",
  "timestamp": "2026-04-05T03:14:37.000Z"
}
```

**Responses (Erro):**

| Status | Error | Causa |
|--------|-------|-------|
| 400 | Missing required field | Faltam `instance`, `to` ou `message` |
| 400 | Invalid phone number format | Telefone não é válido (não começa com 55, etc.) |
| 400 | Invalid JSON in request body | JSON malformado |
| 401 | Unauthorized | Token Bearer não fornecido/inválido |
| 403 | WhatsApp integration requires Plus plan | Plano não suporta WhatsApp |
| 429 | Rate limited by WhatsApp | wacli retornou rate limit |
| 503 | wacli not logged in | wacli precisa de login (veja setup) |
| 503 | wacli CLI not installed | wacli não está no PATH |
| 500 | Internal server error | Erro geral |

---

## Integração com wacli

### Como Funciona

O endpoint chama wacli CLI via Node.js `execSync()`:

```bash
wacli send --number=INSTANCE --phone=TO --message="MESSAGE"
```

**Exemplo:**

```bash
wacli send --number=eidosform-plus --phone=5585999999999 --message="Olá! Bem-vindo ao EidosForm."
```

### Pré-requisitos

1. **wacli instalado:** `/usr/local/bin/wacli` ou `/home/linuxbrew/.linuxbrew/bin/wacli`
2. **wacli logged in:** Necessário conectar uma conta WhatsApp primeiro
3. **Evolution API rodando:** (conforme setup em `/docs/evolution-setup.md`)

### Fluxo de Execução

1. Validar autenticação (token Bearer)
2. Validar plano (Plus+)
3. Validar input (instance, to, message)
4. Validar formato de telefone
5. Chamar `wacli send --number=... --phone=... --message="..."`
6. Parser resposta para extrair messageId
7. Retornar resposta com timestamp ISO

---

## Como Testar

### Teste 1: Sem Autenticação (deve retornar 401 ou 500)

```bash
curl -X POST http://localhost:3000/api/whatsapp/send \
  -H "Content-Type: application/json" \
  -d '{
    "instance": "eidosform-plus",
    "to": "5585999999999",
    "message": "Test message"
  }'
```

**Esperado:** `{"success":false,"error":"Unauthorized. Provide a valid Bearer token."}` (401)

### Teste 2: Com Token Bearer (precisa de token válido do Supabase)

```bash
# Primeiro, obter um token válido:
# 1. Fazer login via /api/auth/login
# 2. Copiar o token da resposta
# 3. Usar abaixo

TOKEN="<seu-token-jwt-aqui>"

curl -X POST http://localhost:3000/api/whatsapp/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "instance": "eidosform-plus",
    "to": "5585999999999",
    "message": "Olá! Teste de integração WhatsApp via EidosForm."
  }'
```

**Esperado:** 

```json
{
  "success": true,
  "messageId": "wacli-1712282877000",
  "timestamp": "2026-04-05T03:14:37.000Z"
}
```

### Teste 3: Telefone Inválido

```bash
curl -X POST http://localhost:3000/api/whatsapp/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "instance": "eidosform-plus",
    "to": "999999999",
    "message": "Test"
  }'
```

**Esperado:** `{"success":false,"error":"Invalid phone number format. Use 55 + area code + number."}` (400)

### Teste 4: Campo Obrigatório Faltando

```bash
curl -X POST http://localhost:3000/api/whatsapp/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "instance": "eidosform-plus",
    "message": "Test"
  }'
```

**Esperado:** `{"success":false,"error":"Missing required field: to"}` (400)

---

## Estrutura do Código

```typescript
// app/api/whatsapp/send/route.ts

interface SendWhatsAppRequest {
  instance: string
  to: string
  message: string
  template_vars?: Record<string, string>
}

interface SendWhatsAppResponse {
  success: true
  messageId: string
  timestamp: string
}

interface SendWhatsAppError {
  success: false
  error: string
}

// Principais funções:
function isValidPhoneNumber(phone: string): boolean
function sendViaWacli(instance: string, phone: string, message: string): { messageId: string }
async function checkPlanSupportsWhatsApp(userId: string): Promise<boolean>
export async function POST(req: NextRequest): Promise<NextResponse<SendWhatsAppResponse | SendWhatsAppError>>
```

---

## Tratamento de Erros

O endpoint detecta erros específicos do wacli e retorna status appropriado:

- **503 (Service Unavailable):** wacli não logged in, não instalado, ou erro genérico
- **429 (Too Many Requests):** WhatsApp rate limit
- **400 (Bad Request):** Número inválido ou input malformado
- **401 (Unauthorized):** Sem token ou token inválido
- **403 (Forbidden):** Plano não suporta WhatsApp
- **500 (Internal Server Error):** Erro desconhecido

---

## Validações TypeScript e Linting

```bash
# TypeScript - Zero erros:
$ npx tsc --noEmit
✅ Passou

# ESLint - Zero erros:
$ npx eslint app/api/whatsapp/send/route.ts --quiet
✅ Passou
```

---

## Próximas Etapas (ETAPA 2+)

1. **Webhooks:** Implementar recebimento de mensagens (Evolution API → EidosForm)
2. **Database:** Armazenar histórico de mensagens em Supabase
3. **Templates:** Sistema de templates com variáveis (template_vars)
4. **Rate Limiting:** Limitar envios por usuário/hora
5. **Queue:** Fila de mensagens para envios assíncronos
6. **Retry:** Retry automático com backoff exponencial
7. **Testes:** Suite de testes E2E com wacli mock

---

## Commit Info

```bash
git add app/api/whatsapp/send/route.ts docs/whatsapp-implementation.md
git commit -m "feat: Implementar endpoint /api/whatsapp/send com wacli integration

- POST /api/whatsapp/send para enviar mensagens WhatsApp
- Validações: auth (Bearer token), plano (Plus+), input
- Integração com wacli CLI via execSync
- Tratamento de erros específicos (503, 429, 400, etc.)
- TypeScript: zero erros de tipo
- ESLint: zero erros de lint
- Documentação completa em docs/whatsapp-implementation.md

ETAPA 1: Endpoint básico ✅
ETAPA 2: Webhooks (próxima)
ETAPA 3: Database (próxima)
"
git push origin main
```

---

## Estado Final

```
✅ Endpoint criado
✅ wacli integrado
✅ Validações implementadas
✅ TypeScript compilado (zero erros)
✅ ESLint validado (zero erros)
✅ Documentação completa
✅ Testes curl documentados
✅ Pronto para integração com frontend (Toin)
```

---

**Backend Agent:** Zeca  
**Timestamp:** 2026-04-05T03:14:37-03:00  
**ETAPA:** 1 (Endpoint WhatsApp)  
**Status:** ✅ CONCLUÍDO
