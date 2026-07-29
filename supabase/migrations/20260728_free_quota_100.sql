-- Cota do plano Free: padroniza em 100 (decisão Sidney, 2026-07-28)
--
-- PROBLEMA (auditoria LP + revisão Codex):
--   - a vitrine (lib/plan-marketing.ts, derivada de PLANS.free.maxResponses) promete 100;
--   - o trigger handle_new_user() gravava 50 em toda conta nova;
--   - o enforcement VIVO é a RPC check_and_increment_response, que RESPEITA
--     profiles.responses_limit (só cai no default 100 quando a coluna é NULL).
--   Ou seja: conta nova era BLOQUEADA em 50 enquanto a página vendia 100.
--   (A leitura anterior de que "o enforcement usa PLANS e ignora a coluna" veio de
--    checkResponseLimit — função MORTA, removida em 9e6c258. O caminho real é a RPC.)
--
-- Esta migração alinha as três pontas em 100.
--
-- ⚠️ Mantém o `phone` de 20260728_signup_phone_to_profile.sql. Não reverter.
-- Aditiva, não destrutiva e SEGURA de rodar mais de uma vez.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, phone, plan, responses_limit, responses_used)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    'free',
    100,
    0
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Regulariza as contas Free já existentes que ficaram abaixo do prometido.
-- Só MEXE em quem está no plano free E abaixo de 100 — nunca reduz cota de
-- ninguém, nunca toca plano pago, e não mexe em cota ilimitada (-1).
UPDATE public.profiles
SET responses_limit = 100
WHERE plan = 'free'
  AND responses_limit IS DISTINCT FROM 100
  AND (responses_limit IS NULL OR responses_limit BETWEEN 0 AND 99);
