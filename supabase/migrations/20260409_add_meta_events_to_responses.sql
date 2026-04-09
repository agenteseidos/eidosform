alter table public.responses
add column if not exists meta_events jsonb not null default '[]'::jsonb;
