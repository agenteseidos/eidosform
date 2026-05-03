# Achados Extras — Execução do Plano de Correções

## BUG-EXTRA-1 — Upload de imagem retorna 413 "Payload muito grande"
**Descoberto em:** 2026-05-02 (durante Etapa 1)
**Severidade:** P1 (bloqueia campo file_upload, mas formulários sem upload funcionam)
**Status:** ⚠️ Pendente (resolver após Bloco A)
**Causa raiz:** Frontend envia imagem em base64 no JSON → payload excede limite. Solução (sign-url + Supabase Storage) implementada no código mas Vercel não está servindo o novo JS (cache agressivo).
**Arquivos já modificados:**
- `app/api/upload/sign-url/route.ts` (novo)
- `app/api/upload/public/route.ts` (deletado)
- `app/api/responses/route.ts` (payload limit ajustado)
- `components/form-player/question-renderer.tsx` (upload via sign-url)
- `lib/field-validators.ts` (validação URL storage)
- `supabase/migrations/20260502_create_form_uploads_bucket.sql` (bucket criado)
**Próximo passo:** Resolver cache Vercel (redeploy manual) e validar upload ponta-a-ponta
