-- Allow form_whatsapp_settings.owner_phone to be NULL.
-- The current UI lets users flip the "Ativar Notificações WhatsApp" toggle
-- before typing the phone number, which causes the auto-save POST to fail
-- with a NOT NULL constraint violation. We switch to nullable + still treat
-- "no phone configured" as "do not send" at the dispatch layer.
alter table form_whatsapp_settings alter column owner_phone drop not null;
