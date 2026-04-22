## Handoff — Toin — 2026-04-22 14:25 GMT-3

### O que foi feito
- Implementação completa do campo UF/estado no billing profile
- Correção do bug CEP bloqueado por CSP
- Migração SQL gerada

### Arquivos alterados
- `components/settings/billing-profile-settings.tsx` — campo UF adicionado, CEP lookup via proxy `/api/cep`, preenchimento automático de UF
- `lib/billing-profile.ts` — tipo `BillingProfile` com `state`, campo required, labels, mapeamento, payload Asaas
- `lib/asaas.ts` — `state` adicionado a `AsaasCustomerPayload`
- `lib/database.types.ts` — coluna `state` nos 3 tipos de profile (Row/Insert/Update)
- `app/(dashboard)/settings/page.tsx` — select inclui `state`, initialData inclui `state`
- `next.config.ts` — `https://viacep.com.br` adicionado ao `connect-src` em ambos headers (protected + embeddable)
- `supabase/migrations/20260422_add_state_to_profiles.sql` — migration nova

### Decisões técnicas
- **Proxy ao invés de fetch direto:** O componente agora usa `/api/cep/${cep}` (server-side proxy já existente) ao invés de `fetch("https://viacep.com.br/...")` direto no browser. Isso elimina o bloqueio CSP por completo e é mais seguro. O CSP foi atualizado como defense-in-depth mesmo assim.
- **UF como campo editável:** maxLength=2, preenchido automaticamente pelo ViaCEP mas editável manualmente.
- **Asaas `state`:** Campo `state` adicionado ao `AsaasCustomerPayload` — o Asaas API usa `state` para UF.

### Resultado do build
- TypeScript: ✅ compila sem erros (`tsc --noEmit` clean)
- Next.js build: ❌ falha em etapa de page data collection (erro pre-existente: `supabaseUrl is required` em `/api/form/[id]/whatsapp/settings`) — **não causado por esta mudança**

### Migration pendente
⚠️ Executar no Supabase:
```sql
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS state text;
```
Arquivo: `supabase/migrations/20260422_add_state_to_profiles.sql`

### Commit
`a18c222` feat: add UF/state field to billing profile + fix CEP lookup

### Pendências
- Executar migration SQL no Supabase
- O erro de build (`supabaseUrl is required`) é pre-existente e não relacionado
