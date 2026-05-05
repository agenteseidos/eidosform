# Achados Extras — Execução do Plano de Correções

## BUG-EXTRA-1 — Upload de imagem retorna 413 "Payload muito grande"
**Descoberto em:** 2026-05-02 (durante Etapa 1)
**Severidade:** P1 (bloqueia campo file_upload, mas formulários sem upload funcionam)
**Status:** ✅ Resolvido em 2026-05-02
**Resolução:** rota nova [app/api/upload/sign-url/route.ts](app/api/upload/sign-url/route.ts) emite signed URL do Supabase Storage; player faz `PUT` direto no bucket sem trafegar a imagem pelo `POST /api/responses`. Bucket criado por [20260502_create_form_uploads_bucket.sql](supabase/migrations/20260502_create_form_uploads_bucket.sql).
**Commits relevantes:** `5d26ff3` (`feat: upload via Supabase Storage signed URL`), `2ee2ead` (diagnostic endpoint), `fa0822f` (payload limit), `0f8e851`.
**Validação pendente em produção:** confirmar com smoke test (Etapa K1) que upload ponta-a-ponta funciona com imagem >1MB.
