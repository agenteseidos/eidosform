-- Dead-letter queue for outgoing webhooks that failed all 4 retry attempts.
-- Used to investigate delivery failures and optionally retry manually.
create table if not exists webhook_failures (
  id           uuid        primary key default gen_random_uuid(),
  form_id      uuid        not null,
  response_id  uuid        not null,
  webhook_url  text        not null,
  last_error   text,
  owner_email  text,
  created_at   timestamptz not null default now(),
  retried_at   timestamptz,
  resolved     boolean     not null default false
);

create index if not exists idx_webhook_failures_form_id
  on webhook_failures (form_id);

create index if not exists idx_webhook_failures_created_at
  on webhook_failures (created_at desc);

-- Only service role writes; form owners can read their own failures
alter table webhook_failures enable row level security;

create policy "service role full access"
  on webhook_failures
  for all
  to service_role
  using (true)
  with check (true);

create policy "form owners read own failures"
  on webhook_failures
  for select
  to authenticated
  using (
    form_id in (
      select id from forms where user_id = auth.uid()
    )
  );
