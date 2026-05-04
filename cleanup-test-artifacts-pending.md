# Limpeza de artefatos de teste em produção (Etapa J2)

> **Status:** ⚠️ Pendente — exige acesso ao Supabase Studio
> **Branch:** `fix/auditoria-fechamento`
> **Data:** 2026-05-04

## Estado atual verificado

- ✅ `/tmp/eidos-audit/` não existe na VPS (já limpo).
- ⚠️ Form e contas de teste no Supabase ainda precisam ser deletados manualmente.

## Ações pendentes

### 1. Deletar form de teste
**Onde:** Supabase Studio > Table Editor > `forms`
**Filtro:** `id = af8ea379-cea0-4471-b1ee-d63e2daffc19`
**Identificador:** título contém `[TESTE-AUDITORIA-2026-05-02]`, slug `teste-auditoria-1777753535312`.

```sql
-- Validar antes
select id, title, slug, status, created_at from forms
where id = 'af8ea379-cea0-4471-b1ee-d63e2daffc19';

-- Deletar (cascade vai limpar responses + answer_items)
delete from forms where id = 'af8ea379-cea0-4471-b1ee-d63e2daffc19';
```

### 2. Deletar contas de teste
**IDs:** `eb2d9c6d-6119-47a2-9c5f-f9bbe95a89ec` e `a4066c51-3c0c-43f3-85f0-7298d2091482`.

```sql
-- Validar antes que não são contas reais
select id, email, created_at, last_sign_in_at
from auth.users
where id in ('eb2d9c6d-6119-47a2-9c5f-f9bbe95a89ec', 'a4066c51-3c0c-43f3-85f0-7298d2091482');
```

Se confirmadas como contas de auditoria (sem atividade real, emails típicos de teste):

```sql
-- Supabase Studio > Authentication > Users > "Delete user" para cada uma
-- (a deleção via UI é mais segura porque dispara os triggers de cleanup)
```

Ou via SQL (pode pular triggers — verificar antes):
```sql
-- delete from profiles where id in ('eb2d9c6d-...', 'a4066c51-...');
-- delete from auth.users where id in ('eb2d9c6d-...', 'a4066c51-...');
```

## Validação pós-execução

```sql
-- 0 linhas esperadas em ambas
select id, title from forms where title ilike '%TESTE-AUDITORIA%';
select id, email from auth.users where id in (
  'eb2d9c6d-6119-47a2-9c5f-f9bbe95a89ec',
  'a4066c51-3c0c-43f3-85f0-7298d2091482'
);
```

**Após executar:** marcar J2 como ✅ no `relatorio-correcoes-auditoria.md` (Etapa K3) e remover este arquivo.
