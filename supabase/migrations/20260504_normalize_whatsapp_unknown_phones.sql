-- Normalize 'unknown' phone_number values to NULL.
-- Going forward, lib/integration-stubs.ts only inserts when a real phone is
-- present (P1-W3 fix), so legacy rows with the literal 'unknown' string can be
-- collapsed to NULL to distinguish "actually missing" from "deliberately blank".
alter table form_whatsapp_logs alter column phone_number drop not null;

update form_whatsapp_logs
set phone_number = null
where phone_number = 'unknown';
