-- Create form_whatsapp_logs table for auditing WhatsApp notifications
create table if not exists form_whatsapp_logs (
  id uuid default gen_random_uuid() primary key,
  form_id uuid not null references forms(id) on delete cascade,
  response_id uuid not null references responses(id) on delete cascade,
  phone_number text not null,
  message_sent text not null,
  status text not null default 'sent', -- 'sent', 'failed', 'pending'
  wacli_message_id text,
  error_message text,
  timestamp timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now()
);

-- Create index for form_id lookups
create index idx_form_whatsapp_logs_form_id on form_whatsapp_logs(form_id);

-- Create index for response_id lookups
create index idx_form_whatsapp_logs_response_id on form_whatsapp_logs(response_id);

-- Create index for timestamp (recent messages)
create index idx_form_whatsapp_logs_timestamp on form_whatsapp_logs(timestamp desc);

-- Enable RLS (optional - only form owner can view logs)
alter table form_whatsapp_logs enable row level security;

create policy "Form owners can view WhatsApp logs for their forms"
  on form_whatsapp_logs
  for select
  using (
    form_id in (
      select id from forms where user_id = auth.uid()
    )
  );

create policy "Service role can insert WhatsApp logs"
  on form_whatsapp_logs
  for insert
  with check (true);
