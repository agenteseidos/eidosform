-- HIGIENE do bucket form-images (2026-07-09) — NÃO é a solução do upload.
--
-- Contexto: o upload da imagem de boas-vindas (browser → storage direto, RLS)
-- estava quebrado pra TODOS os formatos: não existia NENHUMA policy de INSERT
-- em storage.objects. Durante o diagnóstico foram criadas manualmente 2 policies
-- (webp-only e depois uma completa). A solução DEFINITIVA virou rota server-side
-- (POST /api/forms/[id]/welcome-image, service role + magic bytes + ownership),
-- então essas policies ficaram desnecessárias — e deixavam qualquer usuário
-- autenticado escrever no bucket. Este script só remove as sobras.
--
-- ⚠️ Migration MANUAL: rodar no SQL Editor do Supabase Dashboard (produção).

DROP POLICY IF EXISTS "Authenticated pode subir webp em form-images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated pode subir imagens em form-images" ON storage.objects;
-- (storage.prefixes não existe neste projeto — nenhuma policy foi criada lá)
