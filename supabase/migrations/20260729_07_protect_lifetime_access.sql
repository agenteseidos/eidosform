-- Pré-venda 2026-07-29 — concessão Professional vitalícia explícita.
--
-- A conta do Sidney não é uma assinatura e nunca deve entrar nos fluxos
-- automáticos do Asaas. A proteção fica no banco para continuar valendo mesmo
-- se um fluxo futuro tentar gravar expiração, customer/subscription ou Free.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS lifetime_access boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.enforce_lifetime_profile()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Revogar a concessão exige uma ação SQL deliberada como postgres. Rotas da
  -- aplicação, inclusive service_role via PostgREST, não podem desligá-la.
  IF TG_OP = 'UPDATE'
     AND OLD.lifetime_access = true
     AND NEW.lifetime_access = false
     AND current_user <> 'postgres' THEN
    RAISE EXCEPTION 'lifetime_access can only be revoked by postgres'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.lifetime_access = true THEN
    NEW.plan := 'professional';
    NEW.plan_status := 'active';
    NEW.plan_cycle := NULL;
    NEW.plan_expires_at := NULL;
    NEW.responses_limit := 15000;

    -- Concessão vitalícia não é cobrança: impede que crons de billing encontrem
    -- a conta por vínculo acidental criado durante testes.
    NEW.asaas_customer_id := NULL;
    NEW.asaas_subscription_id := NULL;
    NEW.annual_started_at := NULL;
    NEW.proration_basis_days := NULL;
    NEW.billing_period_start_on := NULL;
    NEW.billing_period_end_on := NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_lifetime_profile() FROM PUBLIC;

DROP TRIGGER IF EXISTS enforce_lifetime_profile ON public.profiles;
CREATE TRIGGER enforce_lifetime_profile
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_lifetime_profile();

DO $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.profiles
  SET lifetime_access = true,
      updated_at = now()
  WHERE lower(email) = 'medeiros.sco@gmail.com';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION
      'expected exactly one lifetime profile for medeiros.sco@gmail.com, updated %',
      v_updated;
  END IF;
END;
$$;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_lifetime_entitlement_consistent;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_lifetime_entitlement_consistent
  CHECK (
    lifetime_access = false
    OR (
      plan::text = 'professional'
      AND plan_status = 'active'
      AND plan_cycle IS NULL
      AND plan_expires_at IS NULL
      AND responses_limit = 15000
      AND asaas_customer_id IS NULL
      AND asaas_subscription_id IS NULL
    )
  ) NOT VALID;
ALTER TABLE public.profiles
  VALIDATE CONSTRAINT profiles_lifetime_entitlement_consistent;

SELECT id, email, lifetime_access, plan, plan_status, plan_cycle,
       plan_expires_at, responses_limit, asaas_customer_id,
       asaas_subscription_id
FROM public.profiles
WHERE lifetime_access = true;
