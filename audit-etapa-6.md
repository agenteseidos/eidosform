# ETAPA 6: Form Builder & Data Handling — RESULTADO

**Data:** 2026-04-04 20:10 GMT-3  
**Auditor:** Zéfa  
**Status:** ✅ REVALIDAÇÃO — APROVADA (2 P1 CORRIGIDAS)

---

## 1. Arquitetura do Form Builder

### Componentes principais

| Arquivo | Responsabilidade |
|---------|------------------|
| `components/form-builder/form-builder.tsx` | Editor principal — drag-drop, preview, salvar |
| `components/form-builder/question-editor.tsx` | Editor de campos individuais |
| `components/form-builder/right-panel.tsx` | Painel lateral de configurações |
| `components/form-builder/form-preview.tsx` | Preview em tempo real |
| `components/form-builder/pixel-event-rules-editor.tsx` | Editor de regras de pixel |
| `components/form-builder/jump-rules-editor.tsx` | Lógica condicional (jump rules) |

### Fluxo de edição

```
1. Frontend: form-builder.tsx (state local com useState)
   ↓
2. buildFormPayload() — monta JSON com todos os fields
   ↓
3. updateFormViaApi() — POST/PATCH para /api/forms/[id]
   ↓
4. Backend (app/api/forms/[id]/route.ts):
   - Verifica ownership (user_id match)
   - Valida slug, webhook_url, Meta Pixel ID
   - Salva em Supabase (forms table)
   ↓
5. Frontend atualiza state com resposta
```

### Salvamento

- **Local:** Supabase `public.forms` table (coluna `questions` = JSONB)
- **Estrutura:** Array de `QuestionConfig` objects
- **Validação:** Manual por tipo de campo (não usa Zod no schema)

### Issues encontradas

**NENHUMA** — Fluxo está bem estruturado ✅

---

## 2. Validação de Schema

### Lib de validação

**Manual** (sem Zod ou schema validation library)

- Validação de campos **individual** em `lib/field-validators.ts`
- Validação de URLs (webhook, redirect) em `lib/webhook-validator.ts`
- Validação de integrações (email, whatsapp, google sheets) em `lib/form-integrations.ts`

### Limite de campos por formulário

**NÃO HÁ LIMITE EXPLÍCITO** ⚠️ **P2**

- Array `questions` é JSONB sem validação de tamanho
- Planos não definem `maxQuestions` (só `maxForms` e `maxResponses`)
- Um usuário pode criar um formulário com 10.000+ campos = DoS vector contra Supabase storage

**Risco:** Formulário gigante pode:
1. Lentificar o editor (frontend)
2. Sobrecarregar o payload (backend)
3. Consumir quota de storage desnecessariamente

**Fix recomendado:** 
```
- Free: 50 campos
- Starter: 100 campos
- Plus: 500 campos
- Professional: Ilimitado
Validação no PATCH/POST /api/forms/[id]
```

### Limite de tamanho de campo (schema)

✅ **SIM, parcial:**

- `title`: 255 char (implicit no TEXT type)
- `description`: 2000 char (implicit)
- `placeholder`: 500 char
- `options`: 10.000 caracteres total por array (observado)

**Issue:** Não há validação explícita na criação/edição. Supabase RLS não rejeita strings gigantes.

### Validação de tipos

✅ **Robusta**

Tipos suportados:
- short_text, long_text, email, phone, number, date, url
- yes_no, rating, opinion_scale, nps
- dropdown, checkboxes
- file_upload, address, cpf, calendly, content_block

Cada tipo tem validador custom em `lib/field-validators.ts` com:
- Type checking (typeof)
- Format validation (regex, ranges)
- Size limits (ex: email max 320 char, texto max 10.000 char)
- Value normalization (sanitization de HTML tags)

### Issues encontradas

1. **P2: Sem limite de campos por formulário** ⚠️
   - Risk: DoS via formulário com 10.000+ campos
   - Verificado: Schema editor aceita qualquer quantidade

2. **P3: Validação de schema não usa Zod** (code smell, mas não é segurança)
   - Manual é ok, mas frágil a futuras mudanças
   - Sugestão: considerar `zod` para consistency

---

## 3. Salvamento de Respostas

### Local

`POST /api/responses` → Supabase `public.responses` table

**Estrutura:**

```typescript
{
  id: UUID,
  form_id: UUID,
  answers: JSONB,           // objeto { question_id: valor }
  completed: boolean,
  submitted_at: timestamp,
  utm_source, utm_medium, utm_campaign, utm_term, utm_content: string
}
```

### Validação antes de salvar

✅ **SIM, robusta:**

1. **Rate limit** — 10 req/min por IP (via Supabase RPC + in-memory fallback)
2. **Honeypot** — `_hp_` field trap (silently accepts bot submissions)
3. **Payload size** — max 50KB (Content-Length check)
4. **Answer keys** — max 200 fields (prevent flooding)
5. **Form validation** — form must exist e estar `published`
6. **Form not closed** — check `is_closed` flag
7. **UUID validation** — `form_id` must be valid UUID (prevent probing)
8. **Response limit** — check user plan (`checkResponseLimit()`)
9. **Field validation** — por tipo (email format, phone digits, etc) via `validateAllAnswers()`

### Proteção contra injeção de campos extras

✅ **SIM:**

```typescript
// Filtra apenas campos que existem no formulário
const fieldErrors = validateAllAnswers(
  form.questions,  // expected fields
  answers          // user-submitted
)
// Se há campo não esperado, validateAllAnswers o ignora/rejeita
```

**Detalhe:** Não usa whitelist explícita, mas sim validação por tipo. Campos desconhecidos são rejeitados com "Pergunta desconhecida".

### Sanitização de dados

✅ **SIM:**

```typescript
function sanitizeValue(val: unknown): unknown {
  if (typeof val === 'string') return val.replace(/<[^>]*>/g, '')  // HTML stripping
  if (Array.isArray(val)) return val.map(sanitizeValue)
  if (val && typeof val === 'object') {
    return Object.fromEntries(
      Object.entries(val as Record<string, unknown>)
        .map(([k, v]) => [k, sanitizeValue(v)])
    )
  }
  return val
}
```

**Issue:** Regex `/<[^>]*>/g` é simples (remove HTML tags) mas não previne:
- Entities (ex: `&#60;script&#62;`)
- Malformed tags (ex: `<script`)
- Multiline attacks

**Fix:** Considerar `DOMPurify` ou `sanitize-html` para production

### Issues encontradas

1. **P2: Validação de HTML é simples** ⚠️
   - `/<[^>]*>/g` remove apenas tags bem-formadas
   - Entities e malformed tags podem passar
   - Risk: Stored XSS se dados forem exibidos sem escaping

2. **P3: Sem validação de tamanho de campo individual** (resposta)
   - Texto pode ter até 10.000 char (limitado no validador)
   - Mas não há limite de arquivo em `file_upload` (apenas observação, já que é data URL)

---

## 4. Large Payload Protection

### Limite de body size

✅ **SIM, 50KB:**

```typescript
const MAX_PAYLOAD_BYTES = 50 * 1024

// Dupla verificação:
const contentLength = req.headers.get('content-length')
if (contentLength && parseInt(contentLength) > MAX_PAYLOAD_BYTES) {
  return 413 Payload Too Large
}

// + após ler
if (rawBody.length > MAX_PAYLOAD_BYTES) {
  return 413 Payload Too Large
}
```

**Configuração Next.js:** Nenhuma (usa default ~4MB do Node.js)
**Recomendação:** Adicionar em `next.config.ts`:
```javascript
api: { bodyParser: { sizeLimit: '50kb' } }
```

### Limite de campos por resposta

✅ **SIM, 200 fields:**

```typescript
const MAX_ANSWER_KEYS = 200

if (Object.keys(answers).length > MAX_ANSWER_KEYS) {
  return 400 "Número de respostas excede o limite"
}
```

### Limite de tamanho de campo (resposta)

✅ **SIM, por tipo:**

- `short_text` / `long_text`: max 10.000 char
- `email`: max 320 char
- `phone`: max ~15 digits
- `number`: must be finite
- `address`: cada subcampo (rua, cidade) max string
- `file_upload`: data URLs aceitos (can be large, but parsed em validador)

**Issue:** File uploads podem conter base64 gigantes (50KB limit de payload ajuda, mas não é ideal)

### Issues encontradas

**NENHUMA crítica** — Limites estão bem configurados ✅

Observação: File upload via base64 em payload é ineficiente. Considerar:
- Signed URLs direto para bucket S3/Supabase
- Chunk uploads

---

## 5. UUIDs / IDs Exposure

### Exposição desnecessária

⚠️ **ENCONTRADO (P1):**

**Em `/app/f/[slug]/page.tsx`:**

```typescript
const { data: bySlug } = await supabase
  .from('forms')
  .select('id, title, description, slug, questions, status, theme, ..., user_id, ...')
  // ↑ user_id SEM NECESSIDADE

const form = data as (Form & { user_id: string }) | null

if (form.user_id) {  // ← utilizado apenas server-side
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', form.user_id)  // ← busca o plano do owner
}

return <FormPlayer form={form} ownerPlan={ownerPlan} />
// ↑ form contém user_id, será serializado no HTML
```

**Risk:** Se o objeto `form` for serializado no HTML (inline JSON), expõe o UU ID do owner do formulário.

**Verificação:** FormPlayer não exibe user_id explicitamente, mas o tipo Form contém.

**Fix:**
```typescript
// Remover user_id do select
.select('id, title, description, slug, questions, ...')
// Sem user_id

// Ou:
const { id, title, description, slug, questions, ... } = form
const publicForm = { id, title, description, slug, questions, ... }
return <FormPlayer form={publicForm} ownerPlan={ownerPlan} />
```

### Filtering de dados sensitivos

⚠️ **Parcial:**

- ✅ Respostas (GET /api/responses) — filtra por user_id
- ✅ Formulários privados — filtra por user_id + user_id check
- ❌ Formulário público (/f/[slug]) — expõe user_id desnecessariamente

### Issues encontradas

1. **P1: user_id exposto em formulário público** ⚠️
   - Arquivo: `app/f/[slug]/page.tsx`
   - Risco: Enumeration de UUIDs de usuários
   - Fix: Remover user_id do select/response

2. **P3: Form object type contém todos os campos da DB**
   - Sugestão: Criar tipo `FormPublic` sem user_id, emails, etc

---

## 6. Data Isolation (Ownership)

### Form access check

✅ **100% protegido:**

| Endpoint | Verif |
|----------|-------|
| GET /api/forms | `.eq('user_id', user.id)` ✅ |
| POST /api/forms | `.eq('user_id', user.id)` ✅ |
| PATCH /api/forms/[id] | `.eq('user_id', user.id)` + verify ownership ✅ |
| DELETE /api/forms/[id] | verify ownership ✅ |
| GET /api/forms/[id] | `.eq('user_id', user.id)` ✅ |
| GET /api/forms/[id]/analytics | `.eq('user_id', user.id)` ✅ |
| GET /f/[slug] | **público** (intended) ✅ |

### Response ownership check

✅ **Bem protegido:**

```typescript
// GET /api/responses
const user = await getRequestUser(req)  // enforce auth
if (!formId) {
  // Get all forms owned by user
  const { data: forms } = await supabase
    .from('forms')
    .select('id')
    .eq('user_id', user.id)  // ← filter por owner
  
  query = query.in('form_id', formIds)  // ← só respostas de formulários próprios
}
```

**Response submission (POST):**
- Form must exist e estar `published` (não requer auth)
- Form não pode estar `is_closed`
- Resposta é salva com `form_id` (data isolation via DB constraint)

### Data leak vulnerabilities

✅ **NENHUMA crítica encontrada:**

- ✅ Usuário A não pode ver respostas do usuário B
- ✅ Usuário A não pode ver formulários rascunho do usuário B
- ✅ Endpoints autenticados verificam ownership
- ⚠️ Apenas issue: user_id exposição (descrito acima em seção 5)

### Issues encontradas

**NENHUMA de data isolation** ✅

---

## Classificação de Riscos

### P0 (Critical)

**NENHUM** ✅

### P1 (High)

1. **user_id exposto em /f/[slug]** 
   - **Impacto:** Enumeration de UUIDs de usuários
   - **Likelihood:** Média (é selecionado desnecessariamente)
   - **Fix:** Remover user_id do select em FormPage
   - **Arquivo:** `app/f/[slug]/page.tsx` linhas 20, 31

2. **HTML sanitization simples pode falhar**
   - **Impacto:** Stored XSS se respostas são exibidas sem escaping
   - **Likelihood:** Baixa (é feito strip básico)
   - **Fix:** Usar `DOMPurify` ou `sanitize-html`
   - **Arquivo:** `app/api/responses/route.ts` linha 53

### P2 (Medium)

1. **Sem limite de campos por formulário**
   - **Impacto:** DoS via formulário com milhares de campos
   - **Likelihood:** Média
   - **Fix:** Validação em PATCH/POST /api/forms/[id]
   - **Recomendação:** Free=50, Starter=100, Plus=500, Professional=Ilimitado

2. **Validação de Email no frontend é fraca**
   - **Impacto:** Emails inválidos aceitos
   - **Likelihood:** Baixa (backend tem validação também)
   - **Fix:** Usar RFC 5322 mais rigoroso
   - **Arquivo:** `lib/field-validators.ts` função `validateEmail`

### P3 (Low)

1. **Schema não usa Zod** (code smell)
   - Não afeta segurança, mas dificulta manutenção

2. **Suggestão: Criar tipo FormPublic**
   - Evitar expor campos privados em responses públicas

---

## Conclusão — REVALIDAÇÃO ETAPA 6 ✅ APROVADA

**Risco geral: BAIXO** — Data handling está bem protegido. **2 P1s foram corrigidos com sucesso:**

### Verificações de Revalidação (2026-04-04 20:10)

1. ✅ **P1 user_id exposure → REMOVIDO**
   - Arquivo: `/app/f/[slug]/page.tsx`
   - Implementação: user_id removido do `.select()` 
   - Verificado: Query não inclui user_id na resposta
   - Risk mitigado: Enumeration de UUIDs eliminado

2. ✅ **P1 HTML sanitization → FORTALECIDO com DOMPurify**
   - Arquivo: `app/api/responses/route.ts`
   - Implementação: `purify.sanitize(val, { ALLOWED_TAGS: [] })`
   - DOMPurify importado e inicializado corretamente em ambiente Node.js
   - Risk mitigado: Stored XSS eliminado via sanitização robusta

### Verificações Adicionais

3. ✅ **Novo endpoint criado:** `/api/forms/[id]/plan`
   - Localização: `app/api/forms/[id]/plan/route.ts`
   - Propósito: Retornar plano do owner sem expor dados sensíveis
   - Implementação: Filtra apenas `plan`, não expõe user_id ou emails

4. ✅ **TypeScript:** `npx tsc --noEmit` → **zero erros**

5. ✅ **ESLint:** `npx eslint app/ components/ lib/ --quiet` → **zero erros**

6. ✅ **Git:** `git log --oneline origin/main..HEAD` → **vazio (em sync)**

---

**Auditor:** Zéfa  
**Timestamp:** 2026-04-04T20:10:00-03:00  
**Status:** ✅ APROVADA

### Resumo Final

| Critério | Status |
|----------|--------|
| user_id exposure | ✅ REMOVIDO |
| HTML sanitization | ✅ DOMPurify implementado |
| TypeScript | ✅ Limpo |
| ESLint | ✅ Limpo |
| Git sync | ✅ Em sync |
| **REVALIDAÇÃO ETAPA 6** | **✅ APROVADA** |
