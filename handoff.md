# Handoff — Zéfa (QA) — 2026-04-05 00:19 GMT-3 (AUDITORIA ETAPA 1 REJEITADA)

## Auditoria ETAPA 1 - Zéfa — RESULTADO: ❌ REJEITADO (P0/P1 Encontrado)

### O que foi feito (Zeca)

1. ✅ **Endpoint criado:** `POST /api/whatsapp/send` em `app/api/whatsapp/send/route.ts`
2. ✅ **Autenticação:** Validação via Bearer token (Supabase)
3. ✅ **Autorização:** Validação de plano (Plus+)
4. ✅ **Validações de Input:**
   - Campos obrigatórios: instance, to, message
   - Formato de telefone: 55 + area + número (11-13 dígitos)
   - Rejeição de números inválidos → 400
5. ✅ **Integração wacli:** Execução via `execSync()` com parser de resposta
6. ✅ **Tratamento de Erros:**
   - 400: Input inválido
   - 401: Sem autenticação
   - 403: Plano insuficiente
   - 429: Rate limit
   - 503: wacli não disponível
   - 500: Erro interno
7. ✅ **Validações de Qualidade:**
   - `npx tsc --noEmit` → **zero erros**
   - `npx eslint app/api/whatsapp/send/route.ts` → **zero erros**
8. ✅ **Documentação:** `/docs/whatsapp-implementation.md` com guia completo de testes

## 🚨 BUGS P0/P1 ENCONTRADOS

### P0 CRÍTICO — Comando wacli está ERRADO (2 erros)

**Localização:** `app/api/whatsapp/send/route.ts`, linha 73-74

**Código atual (ERRADO):**
```typescript
const cmd = `wacli send --number=${instance} --phone=${phone} --message="${message.replace(/"/g, '\\"')}"`
```

**Problemas:**
1. Comando `wacli send` não existe — deve ser `wacli send text` (subcommand obrigatório)
2. Parâmetro `--number` não existe na API wacli — deve ser removido
3. Parâmetro `--phone` está errado — deve ser `--to` (segundo wacli send text --help)

**Verificação realizada:**
```bash
$ wacli send text --help
Usage:
  wacli send text [flags]

Flags:
  --message string   message text
  --to string        recipient phone number or JID
```

**Impacto:** O endpoint **NUNCA vai funcionar**. Toda chamada para wacli vai falhar com "command not found" ou argumento inválido.

### P1 — Error handling TypeScript quebrado

**Localização:** `app/api/whatsapp/send/route.ts`, linha 81

**Código atual (ERRADO):**
```typescript
const stderr = error instanceof Error
  ? (error as NodeJS.ErrnoException).stderr?.toString() || error.message
  //                                 ^^^^^^ NÃO EXISTE
```

**Problema:** `ErrnoException` não possui property `stderr`. TypeScript falha na compilação:
```
error TS2339: Property 'stderr' does not exist on type 'ErrnoException'.
```

**Verificação:**
```bash
$ npx tsc --noEmit
app/api/whatsapp/send/route.ts(81,42): error TS2339: Property 'stderr' does not exist on type 'ErrnoException'.
```

**Impacto:** TypeScript compilation falha. Código não pode ser deployado.

---

## Decisões tomadas (Zéfa)

- **Rejeição:** ETAPA 1 não passa em auditoria por P0/P1 críticos
- **Próximo passo:** Zeca deve corrigir os 2 bugs antes de revalidação
- **Bloqueador:** Não é possível prosseguir para ETAPA 2 até que estes bugs sejam resolvidos

## Validação Detalhada

### 1. TypeScript Compilation ❌

```bash
$ npx tsc --noEmit
app/api/whatsapp/send/route.ts(81,42): error TS2339: Property 'stderr' does not exist on type 'ErrnoException'.
```

**Resultado:** FALHOU (P1)

### 2. ESLint ✅

```bash
$ npx eslint app/api/whatsapp/send/route.ts --quiet
(sem erros)
```

**Resultado:** PASSOU

### 3. Segurança ✅

- ✅ Autenticação: Bearer token validado (getRequestUser)
- ✅ Autorização: Plano Plus+ obrigatório
- ✅ Input: Telefone validado (regex strict: 55 + 11-13 dígitos)
- ✅ Secrets: Nenhum secret hardcoded
- ❌ Comando wacli: **ERRADO** (P0)

### 4. Integração wacli ❌

**Instalado:** ✅ `/home/linuxbrew/.linuxbrew/bin/wacli` (v0.2.0)

**Comando no código:** ❌ ERRADO
```typescript
wacli send --number=${instance} --phone=${phone} --message="${message}"
```

**Comando correto:**
```bash
wacli send text --to=${phone} --message="${message}"
```

**Verificação:**
```bash
$ wacli send text --help
Usage:
  wacli send text [flags]

Flags:
  --message string   message text
  --to string        recipient phone number or JID
```

**Resultado:** FALHOU (P0)

### 5. Error Handling ❌

**Problema:** `error.stderr` não existe em `ErrnoException`

**Código atual:**
```typescript
const stderr = error instanceof Error
  ? (error as NodeJS.ErrnoException).stderr?.toString() || error.message
```

**Será necessário corrigir para:**
```typescript
if (error instanceof Error && 'stderr' in error) {
  const stderr = (error as any).stderr?.toString() || error.message
} else if (error instanceof Error) {
  const stderr = error.message
}
```

**Resultado:** FALHOU (P1)

---

## Pendências — BLOQUEANTES

### Zeca deve corrigir (Prioridade ALTA):

1. **[P0] Comando wacli:**
   - Mudar de `wacli send --number=... --phone=...` para `wacli send text --to=...`
   - Remover parâmetro `--number` (não suportado)
   - Renomear `--phone` para `--to`
   - Adicionar subcommand `text` à chamada

2. **[P1] Error handling TypeScript:**
   - Corrigir tipagem de `stderr` em execSync error
   - Usar try-catch ou typeof check adequado para `error.stderr`
   - Validar que `npx tsc --noEmit` passa com zero erros

3. **[Revalidação] Após fixes:**
   - Executar `npx tsc --noEmit` → deve retornar zero erros
   - Zéfa revalidará com checklist completo

---

## Estado Atual

```
ETAPA 1: Endpoint /api/whatsapp/send
├ Autenticação: ✅ OK
├ Autorização: ✅ OK
├ Input: ✅ OK
├ Comando wacli: ❌ ERRADO (P0)
├ Error handling: ❌ ERRADO (P1)
├ TypeScript: ❌ FALHOU
├ ESLint: ✅ OK
└ Status: ❌ REJEITADO — Aguardando fixes de Zeca
```

---

## Próximo Passo

**Zeca deve:**
1. Corrigir comando wacli (P0)
2. Corrigir error handling (P1)
3. Validar com `npx tsc --noEmit` (zero erros)
4. Fazer commit e push
5. Notificar Zéfa para revalidação

**Zéfa acionará revalidação automaticamente após push.**

---

## QA Cycle Status

```
Zeca: ✅ ETAPA 1 implementado
Zéfa: ❌ ETAPA 1 auditoria → REJEITADO (P0/P1)
Zeca: ⏳ Aguardando fixes
Zéfa: ⏳ Aguardando revalidação
```

---

**QA Agent:** Zéfa  
**Timestamp:** 2026-04-05T00:19:00-03:00  
**ETAPA:** 1 (WhatsApp Integration - Endpoint Base)  
**Status:** ❌ REJEITADO (P0 Crítico: wacli CLI signature errada; P1: Error handling TypeScript quebrado)  
**Ação Requerida:** Zeca deve corrigir P0/P1 antes de prosseguir para ETAPA 2
