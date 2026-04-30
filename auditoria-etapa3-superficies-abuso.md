# Auditoria — Etapa 3: Superfícies de abuso interno e automação

**Auditor:** Zéfa | **Data:** 2026-04-30 | **Commit:** `d9086c4`

## 1. SECURITY DEFINER functions — REVOKE/GRANT

**Veredicto: ✅ CORRETO**

- 8 funções com SECURITY DEFINER tiveram `EXECUTE` revogado de `PUBLIC`. Correto.
- GRANT distribuído adequadamente:
  - `cleanup_rate_limit_entries()` e `handle_new_user()` → apenas `service_role` (manutenção e trigger)
  - Demais → `authenticated` + `service_role` (necessário para fluxos autenticados)
- Nenhuma função essencial ficou restrita demais. O app usa `service_role` client nas rotas públicas, então anon nunca chamava essas funções diretamente.

## 2. Forms públicos / exposição de dados sensíveis

**Veredicto: ✅ CORRETO**

- Política `anon_read_published_forms` removida da tabela `forms`. Anon sem acesso direto à tabela. ✅
- View `published_forms` criada com `security_barrier=true`, expondo apenas colunas seguras. Colunas sensíveis omitidas: `user_id`, `webhook_url`, `notify_*`, `google_sheets_*`, etc. ✅
- `GRANT SELECT` na view para `anon` + `authenticated`. ✅
- **Quebra funcional? Não.** O form player (`app/f/[slug]/page.tsx`) usa `createPublicClient()` que usa `service_role` key (bypass RLS). A view serve como defense-in-depth, não como caminho obrigatório.
- **Nota P2:** `published_forms` não é consumida pelo app. Se futuramente o app migrar para client-side com anon key, a view já estará pronta.

## 3. form_whatsapp_logs

**Veredicto: ✅ CORRETO**

- INSERT restrito a `service_role` via política `TO service_role WITH CHECK (true)`. ✅
- SELECT para owners autenticados via `auth.uid()` join com `forms.user_id`. ✅
- Anon sem nenhuma política (sem SELECT, INSERT, UPDATE, DELETE). ✅

## 4. Observações menores

- **P2 — `pixels` na view pública:** A coluna `pixels` (configuração de tracking pixels) é exposta na view `published_forms`. Revela quais pixels o owner usa. Não é P0/P1 (dados de analytics do owner, não do respondente), mas poderia ser removida se quiser maior privacidade do owner.
- **P2 — `fetchOwnerPlan` em `app/f/[slug]/page.tsx`:** Consulta `forms.user_id` via service_role. Seguro pois é server-side, mas é acesso a dado sensível que não precisa acontecer para visitantes anônimos (é usado para decidir plano do owner). Não é vulnerabilidade, mas é surface area.

## 5. Veredito Final — Etapa 3

**✅ APROVADA**

- **P0:** Nenhum encontrado.
- **P1:** Nenhum encontrado.
- **P2:** `pixels` exposto na view pública (baixo impacto, dados de analytics do owner).

Todas as correções da etapa 3 estão corretas e não introduzem quebra funcional.
