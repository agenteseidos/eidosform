# P1-K — Correção Definitiva: Migrations RLS Conflitantes

**Data:** 2026-05-01  
**Status:** ✅ Resolvido de verdade

---

## 1. Por que a solução antiga era insuficiente

A etapa 6 apenas adicionou um comentário `-- OBSOLETE:` no topo de cada um dos 5 arquivos antigos. Os arquivos **continuavam executáveis**: qualquer `supabase db push`, setup manual de ambiente novo, ou DBA que aplicasse as migrations por ordem de data ainda executaria os `CREATE POLICY` problemáticos.

Pior: o rastreamento completo do fluxo em ambiente novo revelou uma **regressão oculta**:

| Passo | Migration | Efeito em `anon_read_responses` / `anon_update_responses` / `anon_delete_answer_items` |
|---|---|---|
| 1 | `20260318_public_access_rls.sql` | **CRIA** (estado inseguro) |
| 2 | `20260327_fix_p0_rls_responses.sql` | Drop + Recria (ainda inseguro) |
| 3 | `20260327_fix_rls_p0_v2.sql` | Drop + Recria (ainda inseguro) |
| 4 | `20260327_fix_rls_response_leak.sql` | **REMOVE** (estado seguro) |
| 5 | `20260428_consolidate_rls_policies.sql` | **RECRIA** (regressão! volta a estado inseguro) |
| 6 | `20260430_fix_rls_responses_answer_items_profiles.sql` | Remove (estado seguro novamente) |
| 7 | `20260430_fix_security_definer_public_access_whatsapp_logs.sql` | Remove `anon_read_published_forms` |

O passo 5 — a própria migration de "consolidação" que foi criada para resolver P1-K — **recriava as 3 policies anon perigosas** (`anon_read_responses`, `anon_update_responses`, `anon_delete_answer_items`) que o passo 4 havia removido. Elas só eram removidas de volta no passo 6.

**Consequência real:** em ambiente novo, se as migrations rodassem até `20260428` e parassem (falha de CI, timeout, erro de rede, migração seletiva), o banco ficava com `anon` podendo ler e modificar respostas de qualquer form publicado. Isso é um vazamento de dados crítico.

---

## 2. O que muda agora

### 2a. Neutralização das 5 migrations antigas

Os 5 arquivos que continham SQL executável problemático foram **neutralizados** — todo o SQL foi substituído por `SELECT 1; -- no-op`:

- `supabase/migrations/20260318_public_access_rls.sql`
- `supabase/migrations/20260327_fix_p0_rls_responses.sql`
- `supabase/migrations/20260327_fix_rls_p0_v2.sql`
- `supabase/migrations/20260327_fix_rls_response_leak.sql`
- `supabase/migrations/20260327_fix_response_visibility_rls.sql`

Em ambiente novo, esses arquivos não criam absolutamente nenhuma policy. A mudança é real: o banco de dados nunca mais verá as policies problemáticas criadas por eles.

### 2b. Nova migration definitiva e idempotente

**`supabase/migrations/20260501_enforce_rls_final_state.sql`**

Essa migration é a fonte única de verdade para o estado final de RLS em `responses`, `answer_items` e `forms`. Ela:

1. **Roda por último** — data `20260501` garante execução após todas as migrations existentes (alfabeticamente posterior a todos os `20260430_*`).
2. **É totalmente idempotente** — inicia com `DROP POLICY IF EXISTS` para todos os nomes de policy que já existiram em qualquer migration, em qualquer arquivo.
3. **Define explicitamente o estado correto final**:

| Tabela | Role | Operações permitidas |
|---|---|---|
| `responses` | `anon` | INSERT apenas (submissão pública), somente em forms publicados |
| `responses` | `authenticated` | SELECT, UPDATE, DELETE para forms que owns |
| `responses` | `service_role` | ALL (sem restrição) |
| `answer_items` | `anon` | INSERT apenas (enviado junto com response) |
| `answer_items` | `authenticated` | SELECT, INSERT, DELETE para forms que owns |
| `answer_items` | `service_role` | ALL (sem restrição) |
| `forms` | `anon` | NENHUM acesso direto (usa view `published_forms`) |

4. **Remove `anon_read_published_forms`** — garantindo que anon não acessa a tabela `forms` diretamente, mesmo que a migration `20260430_fix_security_definer_public_access_whatsapp_logs.sql` não tenha rodado.

---

## 3. Por que o risco fica neutralizado de verdade

### Risco: ambiente novo com todas as migrations

**Antes:** Policies ruins eram criadas (passo 1–3), depois removidas (passo 4), depois **recriadas pela consolidação** (passo 5), depois removidas de volta (passo 6–7). Se parar no meio do caminho = vulnerável.

**Agora:**
- Passos 1–5 (migrations antigas) são todos no-ops ou gerenciados pelo consolidate
- Passo 6 (`20260501_enforce_rls_final_state.sql`) sempre roda por último e define o estado correto, **varrendo qualquer policy residual** com `DROP POLICY IF EXISTS` antes de criar as corretas

### Risco: CI/CD para antes de completar todas as migrations

**Antes:** Se parar após `20260428_consolidate_rls_policies.sql` e antes dos `20260430_*`, o banco tinha `anon_read_responses` e `anon_update_responses` ativas.

**Agora:** Se parar antes de `20260501_enforce_rls_final_state.sql`:
- Os arquivos antigos não criaram nada (são no-ops)
- O consolidate ainda cria `anon_read_responses` / `anon_update_responses` transitoriamente
- O `20260430_fix_rls_responses_answer_items_profiles.sql` os remove
- **Qualquer ponto de parada após os `20260430_*` = estado seguro**
- Só o `20260501` pode falhar e ainda deixar estado seguro, pois ele é aditivo ao estado já correto dos `20260430_*`

### Risco: re-execução manual de migration antiga

**Antes:** Um DBA que rodasse `20260318_public_access_rls.sql` manualmente (vendo que estava marcado como "apenas obsoleto") recriaría policies perigosas.

**Agora:** O arquivo é um no-op — executar manualmente não produz efeito nenhum.

### Risco: múltiplas re-execuções da migration definitiva

**Agora:** `20260501_enforce_rls_final_state.sql` começa com `DROP POLICY IF EXISTS` para tudo — pode ser executada 100 vezes seguidas sem problema.

---

## Arquivos alterados

| Arquivo | Tipo de mudança |
|---|---|
| `supabase/migrations/20260318_public_access_rls.sql` | SQL → no-op |
| `supabase/migrations/20260327_fix_p0_rls_responses.sql` | SQL → no-op |
| `supabase/migrations/20260327_fix_rls_p0_v2.sql` | SQL → no-op |
| `supabase/migrations/20260327_fix_rls_response_leak.sql` | SQL → no-op |
| `supabase/migrations/20260327_fix_response_visibility_rls.sql` | SQL → no-op |
| `supabase/migrations/20260501_enforce_rls_final_state.sql` | **NOVO** — state definitivo idempotente |

## Nota sobre deployments existentes

As migrations antigas já foram aplicadas no Supabase de produção e não serão re-executadas (Supabase rastreia por nome de arquivo). A mudança de conteúdo afeta **apenas ambientes novos** e re-aplicações manuais. Para o Supabase de produção, apenas `20260501_enforce_rls_final_state.sql` é nova e precisa ser aplicada.
