-- UX-notificações (pedido Sidney 05/08, ficha do vault): o e-mail do DONO a cada
-- resposta era SEMPRE enviado, sem opção de desligar — o toggle único controlava
-- só o e-mail adicional (confuso). Este campo dá o toggle próprio do dono.
--
-- DEFAULT true: contas existentes NÃO são silenciadas (regra do desenho aprovado).
-- Aditiva e idempotente; rodar no SQL Editor ANTES do deploy do código que a lê.
ALTER TABLE public.forms
  ADD COLUMN IF NOT EXISTS notify_owner_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.forms.notify_owner_enabled IS
  'Notificação de nova resposta para o e-mail do DONO da conta (par do notify_email_enabled, que controla só o e-mail adicional). Default true — desligar é escolha explícita.';
