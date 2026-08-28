-- Temas da marca disponíveis a todos os planos (27/08/2026).
-- ⚠️ `forms.theme` é ENUM (`public.theme_preset`): o banco tem de aceitar o valor ANTES de o
-- código oferecê-lo no builder, senão o save explode em produção. Rodado pelo Sidney no SQL
-- Editor, com sonda real logo em seguida (PATCH em id inexistente → [] + HTTP 200).
ALTER TYPE public.theme_preset ADD VALUE IF NOT EXISTS 'eidos-escuro';
ALTER TYPE public.theme_preset ADD VALUE IF NOT EXISTS 'eidos-claro';

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20260827_temas_eidos',
  'theme_preset ganha eidos-escuro e eidos-claro (temas da marca, disponiveis a todos os planos)',
  array['ALTER TYPE public.theme_preset ADD VALUE x2;']);
