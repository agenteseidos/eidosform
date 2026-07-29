-- Telefone (WhatsApp) coletado no cadastro → profiles.phone
-- SUPERSEDED: 20260729_04_reconcile_profile_defaults_and_test_limits.sql é a
-- definição canônica posterior (telefone + Free 100 + período mensal).
--
-- O /register passou a pedir Nome → Telefone → E-mail. O telefone viaja em
-- `raw_user_meta_data->>'phone'` (já normalizado em dígitos com DDI pelo
-- /api/auth/signup), exatamente como `full_name` sempre viajou. Esta migração
-- faz o trigger de criação de perfil gravar esse valor em `profiles.phone`.
--
-- Aditiva, não destrutiva e SEGURA de rodar mais de uma vez.
--
-- ⚠️ `profiles.phone_match_key_br` é coluna GERADA (20260724_followup_phone_identity)
-- e NÃO deve ser escrita aqui — ela se recalcula sozinha a partir de `phone`.
--
-- ⚠️ NÃO confundir com `auth.users.phone` (coluna nativa do Supabase, usada só
-- por login/OTP por SMS). Não tocamos nela.
--
-- ⚠️ `responses_limit = 50` É DE PROPÓSITO. A função VIVA em produção (conferida
-- em 2026-07-28 via pg_get_functiondef) grava 50, e não os 100 que o arquivo
-- 20260424_auto_create_profile_on_signup.sql diz. Esta migração só ACRESCENTA o
-- telefone: mexer na cota aqui seria mudança de produto de carona. A divergência
-- entre 50 (coluna) e PLANS.free.maxResponses = 100 (enforcement real em
-- lib/plan-limits.ts:47) é PRÉ-EXISTENTE e está registrada como pendência
-- separada em docs/briefing-telefone-no-cadastro.md §7.

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
    50,
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

-- Rede de segurança: se o código subir ANTES desta migração ser aplicada, o
-- telefone dos cadastros feitos nesse intervalo fica só no metadata do auth.
-- O backfill abaixo recupera esses casos. Só PREENCHE nulos — nunca sobrescreve
-- um telefone que o usuário já editou em Configurações.
UPDATE public.profiles p
SET phone = NULLIF(u.raw_user_meta_data->>'phone', '')
FROM auth.users u
WHERE u.id = p.id
  AND p.phone IS NULL
  AND NULLIF(u.raw_user_meta_data->>'phone', '') IS NOT NULL;

COMMENT ON COLUMN public.profiles.phone IS
  'Telefone/WhatsApp da conta. Coletado no cadastro (obrigatório no /register), editável em Configurações → Dados de cobrança, e usado como telefone do cliente Asaas.';
