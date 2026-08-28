-- Renomeia os temas da marca para o padrão dos demais: UMA palavra, evocativa, sem citar a marca
-- (Midnight, Ocean, Sunset...). Decisão do Sidney em 27/08/2026, poucas horas após a criação.
-- Só a demo usava `eidos-escuro` e nenhum formulário usava `eidos-claro` — renomeação limpa.
-- RENAME VALUE preserva as linhas existentes (o valor muda junto, sem UPDATE).
ALTER TYPE public.theme_preset RENAME VALUE 'eidos-escuro' TO 'onix';
ALTER TYPE public.theme_preset RENAME VALUE 'eidos-claro' TO 'areia';

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20260827_temas_onix_areia',
  'theme_preset: eidos-escuro -> onix, eidos-claro -> areia (padrao de nome dos demais temas)',
  array['ALTER TYPE public.theme_preset RENAME VALUE x2;']);
