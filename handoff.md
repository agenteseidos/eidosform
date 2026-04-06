## Handoff — Zéfa (QA Revalidação) — 2026-04-06 16:45

### Revalidação dos 4 P1 fixes do Zeca (commit 5a079de)

#### P1-1 ✅ Aprovado
- Test endpoint payload corrigido para formato direct `{ instance, to, message }`
- Removidos campos incompatíveis (`phone_number`, `test_mode`)

#### P1-2 ✅ Aprovado
- Auth gate adicionado no form-aware send — retorna 401 sem `isInternal`
- Direct send também protegido (era válido antes, agora explícito)

#### P1-3 ✅ Aprovado
- Template building removido de `integration-stubs.ts`
- `sendWhatsAppOnFormResponse` agora só monta leadData e delega ao send endpoint
- Fonte única de verdade em `buildMessage()` do send endpoint

#### P1-4 ⚠️ Parcialmente corrigido — novo bug introduzido
- Legacy check `notify_whatsapp_enabled` removido ✅
- **MAS:** plan gating usa `planLevel >= 1` que libera **Starter** (índice 1)
- O comentário diz "only Plus+ users" mas o código libera Starter também
- PLAN_ORDER = `['free', 'starter', 'plus', 'professional']`
- **Deveria ser `planLevel >= 2`** para restringir a Plus+

### Novo bug encontrado

#### **P1-NOVO: Plan gating libera Starter para WhatsApp**
- Arquivo: `app/api/responses/route.ts` linha ~312
- `planLevel >= 1` deveria ser `planLevel >= 2`
- Starter users terão WhatsApp habilitado incorretamente
- **Fix trivial:** trocar `>= 1` por `>= 2`

### Estado atual
- TypeScript: ✅ zero erros
- 3 dos 4 P1 totalmente corrigidos
- 1 P1 parcialmente corrigido com novo bug introduzido (fix de 1 caractere)

### Pendências
- P1-NOVO: fix plan gating threshold (Starter → Plus+)
- P2 bugs (5-10) da auditoria original ainda abertos

### Próximo passo sugerido
- Zeca corrige `planLevel >= 1` → `planLevel >= 2` (1 linha)
- Zéfa revalida após fix
