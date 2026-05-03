-- Idempotency table for Asaas incoming webhooks.
-- Prevents double-processing when Asaas retries the same event.
create table if not exists asaas_webhook_events (
  id          uuid        primary key default gen_random_uuid(),
  event_id    text        not null unique,
  event       text        not null,
  processed_at timestamptz not null default now()
);

-- Fast lookup by event_id
create index if not exists idx_asaas_webhook_events_event_id
  on asaas_webhook_events (event_id);

-- Only the service role writes to this table
alter table asaas_webhook_events enable row level security;

create policy "service role full access"
  on asaas_webhook_events
  for all
  to service_role
  using (true)
  with check (true);
