-- Campos ocultos via URL (hidden fields): parâmetros extras da query string
-- (ex.: nome/email/telefone vindos do redirect da página de captura), sanitizados
-- no servidor. Objeto plano {chave: valor}; null quando o lead chega sem params.
-- Briefing: docs/briefing-campos-ocultos-url.md
alter table public.responses add column if not exists url_params jsonb;
