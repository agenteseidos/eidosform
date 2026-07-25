-- Follow-up 24h da Elen — identidade phone-primary.
--
-- `phone_match_key_br` é chave INTERNA de comparação, nunca destino de envio:
-- 55 + DDD + local de 8 dígitos, removendo o 9º dígito móvel quando presente.
-- A coluna gerada mantém todas as escritas (inclusive RLS/client-side) coerentes.

CREATE OR REPLACE FUNCTION public.canonical_phone_match_key_br(raw_phone TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  WITH cleaned AS (
    SELECT regexp_replace(coalesce(raw_phone, ''), '[^0-9]', '', 'g') AS d
  ),
  with_country AS (
    SELECT CASE
      WHEN length(d) IN (10, 11) THEN '55' || d
      WHEN left(d, 2) = '55' AND length(d) IN (12, 13) THEN d
      ELSE NULL
    END AS d
    FROM cleaned
  )
  SELECT CASE
    WHEN length(d) = 12 THEN d
    WHEN length(d) = 13
      AND substr(d, 5, 1) = '9'
      AND substr(d, 6, 1) ~ '^[6-9]$'
      THEN substr(d, 1, 4) || substr(d, 6)
    ELSE NULL
  END
  FROM with_country;
$$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone_match_key_br TEXT
  GENERATED ALWAYS AS (public.canonical_phone_match_key_br(phone)) STORED;

CREATE INDEX IF NOT EXISTS idx_profiles_phone_match_key_br
  ON public.profiles (phone_match_key_br)
  WHERE phone_match_key_br IS NOT NULL;

ALTER TABLE public.billing_checkouts
  ADD COLUMN IF NOT EXISTS billing_phone_match_key_br TEXT;

-- Snapshot automático: preserva a identidade usada na compra mesmo se o profile
-- for editado depois. Não sobrescreve um snapshot já capturado.
CREATE OR REPLACE FUNCTION public.snapshot_billing_phone_match_key_br()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.billing_phone_match_key_br IS NULL AND NEW.profile_id IS NOT NULL THEN
    SELECT p.phone_match_key_br
      INTO NEW.billing_phone_match_key_br
      FROM public.profiles p
      WHERE p.id = NEW.profile_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS billing_checkouts_snapshot_phone ON public.billing_checkouts;
CREATE TRIGGER billing_checkouts_snapshot_phone
BEFORE INSERT OR UPDATE OF profile_id ON public.billing_checkouts
FOR EACH ROW
EXECUTE FUNCTION public.snapshot_billing_phone_match_key_br();

-- Backfill idempotente dos checkouts existentes. A generated column de profiles
-- é calculada automaticamente para todas as linhas existentes ao ser adicionada.
UPDATE public.billing_checkouts bc
SET billing_phone_match_key_br = p.phone_match_key_br
FROM public.profiles p
WHERE bc.profile_id = p.id
  AND bc.billing_phone_match_key_br IS NULL
  AND p.phone_match_key_br IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billing_checkouts_phone_match_key_br
  ON public.billing_checkouts (billing_phone_match_key_br)
  WHERE billing_phone_match_key_br IS NOT NULL;

COMMENT ON COLUMN public.profiles.phone_match_key_br IS
  'Chave BR canônica para match interno (55+DDD+8 dígitos, sem 9º móvel). Não usar para envio.';

COMMENT ON COLUMN public.billing_checkouts.billing_phone_match_key_br IS
  'Snapshot da chave de telefone no checkout; preserva identidade de conversão após edição do profile.';
