-- Migrações MANUAIS recomendadas pela auditoria Codex 2026-07-23.
-- Aplicar no SQL Editor do Supabase (produção). Nenhuma é destrutiva.

-- 1) Relógio de ATIVIDADE pro cron de lead abandonado (hoje usa submitted_at =
--    início). Nullable, default só pra linhas novas, SEM backfill (evitar
--    enxurrada de abandonos antigos). Depois de aplicada: atualizar os dois
--    caminhos de autosave parcial pra setar last_activity_at=now() e trocar o
--    cron de submitted_at -> last_activity_at (exigindo not null).
ALTER TABLE responses ADD COLUMN IF NOT EXISTS last_activity_at timestamptz DEFAULT now();

-- 2) Claim ATÔMICA do alerta de abandono: 1 por response, garantido pelo banco
--    (fecha a corrida SELECT->INSERT apontada no P1-3).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_abandoned_alert_per_response
  ON form_whatsapp_logs (response_id) WHERE status = 'abandoned_alert';

-- 3) Default NOVO do template de mensagem (o default velho ainda mora no banco;
--    o código já cobre, mas rota que omite message_template herdaria o velho).
ALTER TABLE form_whatsapp_settings ALTER COLUMN message_template SET DEFAULT
  E'🔔 *Novo lead* em {form_name}\n\n{respostas}\n\n💬 Responder: {whatsapp_link}\n🕒 Recebido {data} às {horario}\n*Eventos Meta:* {meta_events}';
