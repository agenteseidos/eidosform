-- Idempotência da criação de respostas parciais (fix duplicatas parcial/completo).
--
-- Contexto: o primeiro save parcial pode acontecer via sendBeacon (fechamento da
-- aba), que NÃO consegue ler a resposta — o cliente nunca recebia o response_id
-- e o retorno criava uma segunda response (linha duplicada no Sheets).
--
-- Solução: o cliente gera uma partial_session_key (bearer secret, identifica UMA
-- tentativa de preenchimento — não uma pessoa) e a envia em todo save; o servidor
-- persiste apenas o SHA-256. O índice único garante no BANCO que fetch/beacon/submit
-- concorrentes convergem pra mesma row (create-or-adopt via 23505).
--
-- ⚠️ Índice PERMANENTE (sem predicado de completed) — decisão da auditoria Codex
-- 2026-07-08: com predicado "completed=false", um beacon atrasado pós-submit
-- recriaria uma parcial órfã. Row completada retém o hash; o servidor responde
-- already_completed e não cria nada. Preenchimento novo legítimo = key nova
-- (o cliente rotaciona após o submit).

alter table responses add column if not exists partial_session_hash text;
alter table responses add column if not exists partial_revision integer;

create unique index if not exists responses_form_partial_session_hash_uidx
  on responses (form_id, partial_session_hash)
  where partial_session_hash is not null;
