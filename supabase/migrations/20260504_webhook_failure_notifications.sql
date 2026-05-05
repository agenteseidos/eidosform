-- Tracks when the form owner was last notified about webhook failures.
-- Prevents email-spam: notify at most once per 24h per form.
create table if not exists webhook_failure_notifications (
  form_id              uuid        primary key references forms(id) on delete cascade,
  last_notified_at     timestamptz not null default now(),
  failure_count_window int         not null default 0
);

alter table webhook_failure_notifications enable row level security;

create policy "service role full access webhook_failure_notifications"
  on webhook_failure_notifications
  for all
  to service_role
  using (true)
  with check (true);

create policy "owners read own webhook_failure_notifications"
  on webhook_failure_notifications
  for select
  to authenticated
  using (
    form_id in (select id from forms where user_id = auth.uid())
  );
