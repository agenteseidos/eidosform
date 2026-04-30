-- 20260430: Etapa 3 — Superfícies de abuso interno e automação
--
-- 1. REVOKE EXECUTE on SECURITY DEFINER functions from PUBLIC
-- 2. Restrict form_whatsapp_logs INSERT to service_role only
-- 3. Create secure view for public form reads (excludes sensitive columns)
-- 4. Replace anon_read_published_forms to use column-safe view

-- ============================================================
-- 1. SECURITY DEFINER functions: revoke PUBLIC execute
-- ============================================================
-- By default, PostgreSQL grants EXECUTE on functions to PUBLIC.
-- SECURITY DEFINER functions run as the function owner (typically superuser),
-- so PUBLIC execute = privilege escalation.

REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limit_entries() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_response_counts_by_forms(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_and_increment_response(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_responses_used(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.verify_api_key_hash(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_response_count(uuid) FROM PUBLIC;

-- Grant execute only to authenticated users and service_role where appropriate
-- Rate limit functions: need to be callable by authenticated users (app routes use anon client via service_role)
-- But the actual callers are API routes using service_role key, so authenticated + service_role is fine.
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limit_entries() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_response_counts_by_forms(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_and_increment_response(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_responses_used(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_api_key_hash(text) TO authenticated, service_role;
-- handle_new_user is a trigger function — only PostgreSQL (trigger context) should call it
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_response_count(uuid) TO authenticated, service_role;

-- ============================================================
-- 2. form_whatsapp_logs: restrict INSERT to service_role only
-- ============================================================
-- Current policy "Service role can insert WhatsApp logs" uses WITH CHECK (true)
-- which effectively allows ANYONE to insert. Replace with role-scoped policy.

DROP POLICY IF EXISTS "Service role can insert WhatsApp logs" ON form_whatsapp_logs;

-- Only service_role can insert (the server-side WhatsApp dispatch uses service_role client)
CREATE POLICY "service_role_insert_whatsapp_logs" ON form_whatsapp_logs
  FOR INSERT TO service_role
  WITH CHECK (true);

-- Form owners can SELECT their logs (keep existing, but scope to authenticated)
DROP POLICY IF EXISTS "Form owners can view WhatsApp logs for their forms" ON form_whatsapp_logs;
CREATE POLICY "owners_read_whatsapp_logs" ON form_whatsapp_logs
  FOR SELECT TO authenticated
  USING (
    form_id IN (
      SELECT id FROM forms WHERE user_id = auth.uid()
    )
  );

-- No anon access to whatsapp_logs at all (no SELECT, INSERT, UPDATE, DELETE)

-- ============================================================
-- 3. Secure public view for published forms
-- ============================================================
-- Create a view that only exposes columns safe for public consumption.
-- Sensitive columns (webhook_url, notify_*, google_sheets_*, user_id, etc.) are excluded.

CREATE OR REPLACE VIEW public.published_forms AS
SELECT
  id,
  title,
  description,
  slug,
  status,
  theme,
  questions,
  thank_you_message,
  thank_you_title,
  thank_you_description,
  thank_you_button_text,
  thank_you_button_url,
  pixels,
  redirect_url,
  welcome_enabled,
  welcome_title,
  welcome_description,
  welcome_button_text,
  welcome_image_url,
  is_closed,
  paused,
  hide_branding,
  pixel_event_on_start,
  pixel_event_on_complete,
  created_at,
  updated_at
FROM public.forms
WHERE status = 'published';

-- Security barrier prevents users from joining back to the underlying table
-- to access excluded columns.
-- Note: PostgreSQL doesn't support ALTER VIEW SET (security_barrier) on all versions,
-- so we recreate with the option.
DROP VIEW IF EXISTS public.published_forms;
CREATE VIEW public.published_forms WITH (security_barrier = true) AS
SELECT
  id,
  title,
  description,
  slug,
  status,
  theme,
  questions,
  thank_you_message,
  thank_you_title,
  thank_you_description,
  thank_you_button_text,
  thank_you_button_url,
  pixels,
  redirect_url,
  welcome_enabled,
  welcome_title,
  welcome_description,
  welcome_button_text,
  welcome_image_url,
  is_closed,
  paused,
  hide_branding,
  pixel_event_on_start,
  pixel_event_on_complete,
  created_at,
  updated_at
FROM public.forms
WHERE status = 'published';

-- Grant read access to anon and authenticated on the view
GRANT SELECT ON public.published_forms TO anon, authenticated;

-- ============================================================
-- 4. Replace anon_read_published_forms policy
-- ============================================================
-- The old policy allowed anon to SELECT * from forms where status='published',
-- exposing sensitive columns. Replace with a restrictive policy that blocks anon
-- from directly accessing the forms table entirely.
-- The form player should use the published_forms view instead.

DROP POLICY IF EXISTS "anon_read_published_forms" ON forms;

-- anon has NO direct SELECT on forms table.
-- Public form reads go through published_forms view (step 3).

-- authenticated: owners can read their own forms (keep existing behavior)
-- authenticated: non-owners can read published forms (needed for some flows)
-- But only safe columns — we enforce this at the application layer since
-- Supabase RLS doesn't support column-level SELECT policies natively.
-- The key protection is that anon can't query the forms table at all.
