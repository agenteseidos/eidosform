-- Pré-venda 2026-07-29 — estado canônico do perfil e correção das contas de teste.
--
-- Esta definição substitui as duas migrations de 2026-07-28 que divergiam
-- entre 50 e 100. Em instalações novas, esta migration posterior é a verdade.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

-- Snapshot mínimo do estado de confirmação: evita consultar auth.users pelo
-- PostgREST e impede que um cadastro não confirmado plante identidade de telefone.
UPDATE public.profiles AS p
SET email_confirmed_at = u.email_confirmed_at
FROM auth.users AS u
WHERE u.id = p.id
  AND p.email_confirmed_at IS DISTINCT FROM u.email_confirmed_at;

CREATE OR REPLACE FUNCTION public.sync_profile_email_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.profiles
  SET email_confirmed_at = NEW.email_confirmed_at
  WHERE id = NEW.id
    AND email_confirmed_at IS DISTINCT FROM NEW.email_confirmed_at;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_profile_email_confirmation() FROM PUBLIC;

DROP TRIGGER IF EXISTS sync_profile_email_confirmation ON auth.users;
CREATE TRIGGER sync_profile_email_confirmation
AFTER UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.sync_profile_email_confirmation();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    phone,
    email_confirmed_at,
    plan,
    responses_limit,
    responses_used,
    response_period_start_at,
    response_period_end_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    NEW.email_confirmed_at,
    'free',
    100,
    0,
    now(),
    now() + interval '1 month'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

-- Contas antigas de teste confirmadas pelo Sidney; não são concessões.
-- RETURNING deixa a alteração visível no SQL Editor durante a aplicação.
UPDATE public.profiles
SET responses_limit = CASE plan::text
      WHEN 'starter' THEN 1000
      WHEN 'plus' THEN 5000
      WHEN 'professional' THEN 15000
      ELSE 100
    END,
    updated_at = now()
WHERE lower(email) IN ('pro@test.eidos', 'zefa-v5-14157@test.eidos.com')
  AND responses_used = 0
  AND asaas_customer_id IS NULL
  AND plan::text IN ('starter', 'plus', 'professional')
RETURNING id, email, plan, responses_limit;
