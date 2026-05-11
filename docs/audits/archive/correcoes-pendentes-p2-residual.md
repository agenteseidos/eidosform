# Correção P2 Residual — Janela Insegura em `20260428_consolidate_rls_policies.sql`

**Data:** 2026-05-01  
**Commit:** ver git log  
**Status:** ✅ Concluída

---

## 1. O que foi alterado

**Arquivo:** `supabase/migrations/20260428_consolidate_rls_policies.sql`

Removidos três blocos `CREATE POLICY` que criavam policies inseguras para o role `anon`:

| Policy removida | Tabela | Operação permitida (indevidamente) |
|---|---|---|
| `anon_read_responses` | `responses` | SELECT — anon lia respostas de qualquer form publicado |
| `anon_update_responses` | `responses` | UPDATE — anon modificava respostas de qualquer form publicado |
| `anon_delete_answer_items` | `answer_items` | DELETE — anon deletava answer_items de respostas de forms publicados |

Os `DROP POLICY IF EXISTS` correspondentes foram **mantidos** no arquivo (explicação abaixo).

Adicionado comentário de cabeçalho explicando a remoção e o motivo.

---

## 2. Por que elimina a janela residual

### A janela antes da correção

O Supabase aplica as migrations em ordem alfabética/temporal. O fluxo de um deploy limpo era:

```
20260428_consolidate_rls_policies.sql   ← CRIA anon_read/update_responses + anon_delete_answer_items
20260430_fix_rls_responses_...sql       ← REMOVE anon_read/update_responses + anon_delete_answer_items
20260501_enforce_rls_final_state.sql    ← Estado correto definitivo
```

Se o deploy parasse (ou fosse interrompido) **após `20260428` e antes de `20260430`**, o banco ficava com:
- `anon` podendo ler **todas** as respostas de forms publicados (vazamento de dados)
- `anon` podendo modificar respostas (integridade de dados comprometida)
- `anon` podendo deletar answer_items (perda de dados)

Essa janela existia em **qualquer ambiente novo** que rodasse as migrations nessa ordem.

### Por que a janela está eliminada agora

Com a remoção dos três `CREATE POLICY` do arquivo `20260428`, um deploy que pare exatamente após `20260428` resulta em:

- `anon_insert_responses` ✅ (necessário para submissão pública)
- `anon_read_responses` ❌ nunca criado
- `anon_update_responses` ❌ nunca criado
- `anon_delete_answer_items` ❌ nunca criado

Não há mais estado inseguro em nenhum ponto da sequência de migrations.

---

## 3. Por que não quebra ambientes existentes

### Ambientes que já rodaram `20260428` (produção, staging)

Esses ambientes já têm as migrations `20260430_*` e `20260501_*` aplicadas:
- `20260430` já removeu `anon_read_responses` e `anon_update_responses`
- `20260501` impõe o estado correto idempotente (DROP + CREATE de tudo)

Supabase não re-executa uma migration que já foi registrada na tabela `supabase_migrations`. Modificar `20260428` não altera esses ambientes em nada.

### `DROP IF EXISTS` mantidos no `20260428`

Os drops de `anon_read_responses`, `anon_update_responses` e `anon_delete_answer_items` foram mantidos no arquivo. Isso tem dois efeitos úteis:

1. **Limpeza preventiva:** se por algum motivo essas policies existirem de um deploy antigo antes desta correção, o `20260428` (caso re-aplicado manualmente) as remove.
2. **Sem efeito colateral:** `DROP POLICY IF EXISTS` em uma policy que não existe é um no-op — sem erro, sem alteração de estado.

### `20260430_fix_rls_responses_answer_items_profiles.sql`

Esse arquivo continua fazendo `DROP POLICY IF EXISTS "anon_read_responses"` etc. Com as policies nunca criadas em ambientes novos, esses drops são no-ops — comportamento correto.

### `20260501_enforce_rls_final_state.sql`

A migration definitiva continua válida e idempotente. Dropa e recria tudo do zero — não depende de qual estado as migrations anteriores deixaram.

---

## Resumo da cadeia de segurança pós-correção

| Ponto de parada no deploy | Estado das policies perigosas | Seguro? |
|---|---|---|
| Antes de qualquer migration | Nenhuma policy | ✅ |
| Após `20260428` | `anon_read/update/delete` jamais criadas | ✅ |
| Após `20260430` | Idem; drops são no-ops | ✅ |
| Após `20260501` | Estado definitivo aplicado | ✅ |
| Qualquer ponto intermediário | Nunca inseguro | ✅ |

**P2 residual: zerado.**
