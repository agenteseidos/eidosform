# Briefing — Upload da imagem de boas-vindas quebrado (RLS) + suporte WEBP

> Para análise do Codex. Contexto completo do que foi feito hoje (2026-07-09), o que
> está dando errado e as hipóteses em aberto. Pedimos análise do CÓDIGO também, não
> só do banco.

## Demanda original

Aceitar `.webp` em todos os pontos de upload da plataforma EidosForm. No caminho,
descobrimos algo maior: **o upload da imagem da tela de boas-vindas está quebrado
para TODOS os formatos** (violação de RLS), não só webp — e possivelmente nunca
funcionou, ou quebrou em algum momento sem ninguém notar.

## Arquitetura do caminho quebrado

- `components/form-builder/form-builder.tsx` → `handleWelcomeImageUpload` (~linha 415):
  valida tipo/tamanho no client e chama
  `supabase.storage.from('form-images').upload('welcome/${form.id}/${Date.now()}.${ext}', file, { upsert: true })`
  usando o client de BROWSER (`lib/supabase/client.ts` — singleton de
  `createBrowserClient` do `@supabase/ssr@^0.8.0`, `supabase-js@^2.89.0`).
- Contraste que FUNCIONA: anexos de pergunta no player passam por endpoint
  server-side (`app/api/upload/route.ts` + `app/api/upload/sign-url/route.ts`,
  ALLOWED_TYPES já inclui `image/webp`, validação por magic bytes, service role).

## Estado do banco (produção, verificado hoje via service key + SQL Editor)

- Bucket `form-images`: `public: true`, `file_size_limit: null`, `allowed_mime_types: null`
  (criado manualmente em 2026-03-24; NÃO está nas migrations).
- `pg_policies` do schema `storage` (lista COMPLETA antes da última correção):
  | tablename | policyname | cmd | permissive | roles |
  |---|---|---|---|---|
  | objects | Authenticated pode subir webp em form-images | INSERT | PERMISSIVE | {authenticated} |
  | objects | Public read form-uploads | SELECT | PERMISSIVE | {public} |
- Ou seja: **não existia NENHUMA policy de INSERT** em `storage.objects` antes de hoje.
  Upload browser→storage de welcome image não tinha como funcionar para formato nenhum.
- Depois disso foi rodado (SQL Editor, produção) um bloco que: (1) dropou a policy
  webp-only e criou `"Authenticated pode subir imagens em form-images"` FOR INSERT TO
  authenticated WITH CHECK (bucket form-images + extensão em svg/png/jpg/jpeg/gif/webp);
  (2) checou `storage.prefixes` condicionalmente. *(Estado presumido — vale re-verificar
  com `SELECT * FROM pg_policies WHERE schemaname='storage'`.)*
- Tabelas do schema `storage` (TODAS com `relrowsecurity = true`): migrations,
  s3_multipart_uploads, s3_multipart_uploads_parts, buckets_vectors, vector_indexes,
  buckets_analytics, buckets, objects. **NÃO existe `storage.prefixes`** (hipótese descartada).

## O que já foi tentado (e o resultado)

1. **Front** (deployado, funciona): accept + validação + hint agora incluem webp
   (`right-panel.tsx:143/137`, `form-builder.tsx:417`). Toast agora expõe o erro real.
2. **Diagnóstico empírico via Storage REST API**:
   - upload de webp com **service_role** → ✅ SUCESSO (bucket ok, formato ok);
   - upload com **anon key** → ❌ `new row violates row-level security policy`.
3. **Policy INSERT criada** (webp-only, verificada existir via pg_policies; depois
   substituída pela versão completa com todos os formatos).
4. **Erro do usuário PERSISTE inalterado** após cada correção:
   `Erro ao enviar imagem. (new row violates row-level security policy)` — usuário
   logado (badge Admin visível, sessão ativa), qualquer formato (png incluído).

## Hipótese principal em aberto (é AQUI que pedimos análise de código)

O erro do usuário autenticado é **idêntico** ao do teste com anon key. Suspeita: a
request de storage do browser está saindo **sem o JWT do usuário** (como `anon`), e
portanto as policies `TO authenticated` nunca se aplicam. Investigar:

a) `lib/supabase/client.ts`: o singleton `createBrowserClient` é criado no primeiro
   `createClient()`. Existe cenário no builder em que o storage-js não anexa
   `Authorization: Bearer <access_token>` (sessão ainda não hidratada dos cookies,
   refresh não propagado, singleton criado cedo demais)?
b) Como confirmar: instrumentar `supabase.auth.getSession()` imediatamente antes do
   upload e/ou inspecionar no DevTools o header `Authorization` do
   `POST /storage/v1/object/form-images/...` (se for o anon key JWT = confirmado).
c) `upsert: true` exige algo além de INSERT nesse fluxo do storage-api? (filename tem
   `Date.now()`, conflito é improvável — mas conferir).
d) Hipótese secundária: todas as tabelas do storage têm RLS ligada e NÃO há policy
   nenhuma em `storage.buckets` — a versão atual do storage-api exige SELECT em
   `buckets` pro upload autenticado? (o erro seria outro, mas descartar com base.)

## Perguntas objetivas pro Codex

1. Rastrear o caminho do upload no código e confirmar/refutar a hipótese (a): o token
   do usuário chega no POST do storage? Propor o teste mais barato pra cravar.
2. Recomendar a solução definitiva com prós/contras e patch:
   - **Opção A**: manter upload client-side + consertar RLS/policies;
   - **Opção B**: migrar a welcome image pro padrão server-side que já existe
     (`/api/upload` com service role + validação de MIME/magic bytes + checagem de
     ownership do form) — mata a dependência de RLS de storage de vez.
3. Propor a migration canônica final — a que está no repo
   (`supabase/migrations/20260709_allow_webp_form_images.sql`) ficou desatualizada
   (reflete só a 1ª tentativa webp-only).
4. Varrer se há outros pontos do produto que gravam no storage direto do browser e
   dependem de policies que não existem (mesma classe de bug latente).

## Como reproduzir

Login no builder (conta admin), form `x7e9d32p` → painel direito "Tela de Boas
Vindas" → Imagem → subir qualquer png/webp < 2MB → toast
`Erro ao enviar imagem. (new row violates row-level security policy)`.

## Commits de hoje na main (contexto)

- `4654731` fix(player): preserva quebras de linha nas descrições
- `b9e6d50` fix(player): alarga welcome/obrigado no desktop
- `3110698` feat(builder): aceita WEBP no upload da welcome image (front)
- `c428a4c` chore(db): migration manual RLS webp — **desatualizada, ver pergunta 3**
- `2e8b1a4` fix(builder): toast do upload mostra a causa real do erro
