-- Permite upload de WEBP no bucket form-images (imagem da tela de boas-vindas).
-- Contexto: o bucket form-images foi criado manualmente (2026-03) com uma policy
-- de INSERT que restringe as extensões antigas (svg/png/jpg/jpeg/gif) — ela não
-- está nas migrations. Em vez de editar essa policy às cegas, adiciona-se uma
-- policy PERMISSIVA extra (policies permissivas fazem OR entre si): autenticado
-- pode inserir .webp em form-images. Zero impacto no comportamento existente.
-- Diagnóstico 2026-07-09: bucket sem allowed_mime_types (null) e upload webp com
-- service_role passa — o bloqueio é só a policy RLS do papel authenticated.
--
-- ⚠️ Migration MANUAL: rodar no SQL Editor do Supabase Dashboard (produção).

CREATE POLICY "Authenticated pode subir webp em form-images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'form-images'
  AND (
    storage."extension"(name) = 'webp'
    OR (metadata ->> 'mimetype') = 'image/webp'
  )
);
