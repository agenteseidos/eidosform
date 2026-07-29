# Runbook — correção pré-venda de 2026-07-29

Este roteiro preserva compatibilidade entre a versão atual e a nova. Execute
cada arquivo inteiro no SQL Editor do Supabase e interrompa a sequência se
qualquer comando falhar.

## 1. Pré-deploy

Aplicar, nesta ordem:

1. `supabase/migrations/20260729_01_create_public_domain_resolver.sql`
2. `supabase/migrations/20260729_03_monthly_atomic_response_quota.sql`
3. `supabase/migrations/20260729_04_reconcile_profile_defaults_and_test_limits.sql`

A migration 04 termina com `RETURNING`. O resultado esperado são as duas contas
de teste informadas pelo Sidney, cada uma com o limite canônico do plano.

Validação pré-deploy:

```sql
SELECT
  to_regprocedure('public.resolve_public_custom_domain(text)') AS domain_rpc,
  to_regprocedure('public.check_and_increment_response(uuid,uuid)') AS quota_rpc,
  to_regprocedure('public.refresh_response_quota_period(uuid)') AS refresh_rpc;

SELECT
  count(*) FILTER (WHERE response_period_start_at IS NULL) AS period_start_null,
  count(*) FILTER (WHERE response_period_end_at IS NULL) AS period_end_null
FROM public.profiles;

SELECT id, email, plan, responses_limit, responses_used,
       response_period_start_at, response_period_end_at
FROM public.profiles
WHERE lower(email) IN ('pro@test.eidos', 'zefa-v5-14157@test.eidos.com');

SELECT public.resolve_public_custom_domain('dominio-inexistente.eidosform.com');
```

Esperado: as três funções existem; os dois contadores de `NULL` são zero; as
contas de teste têm 1.000/5.000/15.000 conforme o plano; o domínio inexistente
retorna zero linhas. Como `custom_domains` está vazio, não há domínio real a
usar neste teste.

## 2. Deploy do código

Publicar o SHA revisado via `git push origin main`. Não usar `vercel --prod`.
Confirmar que o deployment foi criado, chegou a `READY` e serve o mesmo SHA.

Antes de fechar as policies antigas:

- abrir um formulário publicado em `/f/<slug>`;
- concluir uma resposta controlada e anotar `response_id`;
- repetir a mesma submissão/session key e confirmar `already_completed`;
- confirmar no banco que a primeira finalização incrementou uma vez e que o
  retry não incrementou novamente:

```sql
SELECT r.id, r.completed, r.quota_counted_at, f.user_id,
       p.responses_used, p.responses_limit,
       p.response_period_start_at, p.response_period_end_at
FROM public.responses r
JOIN public.forms f ON f.id = r.form_id
JOIN public.profiles p ON p.id = f.user_id
WHERE r.id = '<response_id-do-teste>';
```

Também validar login com destino de checkout, upload JPEG/PDF numa pergunta de
upload e carregamento das páginas `/billing` e `/settings`.

## 3. Pós-deploy

Somente depois dos testes da etapa 2, aplicar:

1. `supabase/migrations/20260729_02_close_legacy_anon_rls.sql`
2. `supabase/migrations/20260729_05_drop_legacy_quota_rpc.sql`
3. `supabase/migrations/20260729_06_harden_direct_write_privileges.sql`
4. `supabase/migrations/20260729_07_protect_lifetime_access.sql`
5. `supabase/migrations/20260729_08_grandfather_deploy_window_responses.sql`

A migration 07 deve retornar somente `medeiros.sco@gmail.com`, marcada como
Professional vitalícia, sem expiração nem identificadores do Asaas. A migration
08 deve retornar a resposta `4a317151-9656-4213-9fec-1147701aa397` (e qualquer
outra criada pelo código legado durante a janela), sem alterar
`profiles.responses_used`.

Validação de grants e policies:

```sql
SELECT
  has_table_privilege('anon', 'public.forms', 'SELECT') AS anon_forms_select,
  has_table_privilege('anon', 'public.custom_domains', 'SELECT') AS anon_domains_select,
  has_table_privilege('anon', 'public.responses', 'INSERT') AS anon_responses_insert,
  has_table_privilege('anon', 'public.answer_items', 'INSERT') AS anon_answers_insert,
  has_table_privilege('anon', 'public.published_forms', 'SELECT') AS anon_safe_view_select,
  has_function_privilege(
    'anon',
    'public.resolve_public_custom_domain(text)',
    'EXECUTE'
  ) AS anon_domain_rpc;

SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('forms', 'responses', 'answer_items', 'custom_domains', 'profiles')
ORDER BY tablename, policyname;

SELECT
  to_regprocedure('public.check_and_increment_response(uuid)') AS legacy_quota_rpc,
  to_regprocedure('public.check_and_increment_response(uuid,uuid)') AS current_quota_rpc;

SELECT email, lifetime_access, plan, plan_status, plan_expires_at,
       responses_limit, asaas_customer_id, asaas_subscription_id
FROM public.profiles
WHERE lifetime_access = true;

SELECT id, completed, quota_counted_at
FROM public.responses
WHERE id = '4a317151-9656-4213-9fec-1147701aa397';
```

Esperado: os quatro privilégios diretos `anon_*` são `false`; a view segura e
a RPC mínima são `true`; a RPC legada é `NULL`; a RPC atual existe.

Repetir o smoke test de formulário publicado e submissão após o fechamento de
RLS. Uma falha nessa etapa pede rollback pontual dos grants/policies, não
`vercel --prod`.

## 4. Critério de encerramento

A entrega só está concluída quando:

- o SHA em produção foi conferido;
- o acesso anônimo direto às quatro tabelas foi negado;
- player e submissão continuam funcionando;
- finalização fresca incrementa a cota uma vez;
- retry, adoção por session key e corrida `23505` convergem para a mesma
  `response_id` sem segunda cobrança;
- o contador renova pelo período mensal explícito, independentemente do ciclo
  mensal ou anual do Asaas.
