-- Migrações MANUAIS da stack de notificação por WhatsApp.
-- Aplicar no SQL Editor do Supabase. Nenhuma é destrutiva.
--
-- ⚠️ CORRIGIDA em 2026-07-23 após INCIDENTE REAL EM PRODUÇÃO (P2-1 da 2ª
--    auditoria Codex). A versão anterior deste arquivo fazia:
--
--        ALTER TABLE responses ADD COLUMN ... last_activity_at timestamptz DEFAULT now();
--
--    com o comentário "default só pra linhas novas, SEM backfill". ISSO ESTÁ
--    ERRADO: no Postgres, `ADD COLUMN ... DEFAULT <valor>` PREENCHE TAMBÉM AS
--    LINHAS EXISTENTES com o valor no instante da migração. Resultado real: 213
--    respostas parciais de até ~127 dias atrás passaram a ter
--    `last_activity_at = agora`, viraram "abandonos recentes" aos olhos do cron
--    e ~36 ALERTAS FALSOS foram enviados a donos de formulário reais, além de
--    estourar o timeout da function.
--
--    A produção já foi corrigida à mão (backfill com submitted_at), mas ESTE
--    ARQUIVO repetiria o dano num ambiente novo/restore. A ordem abaixo
--    (ADD sem default → backfill explícito → SET DEFAULT) é a única segura:
--    nenhuma linha antiga ganha um relógio que não é o dela.

-- 1a) Coluna SEM default: linhas existentes ficam NULL. NULL nunca entra na
--     janela do cron (que compara com `<` e `>`), então ausência de dado não
--     dispara alerta — fail-safe por construção.
ALTER TABLE responses ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

-- 1b) BACKFILL EXPLÍCITO com o tempo REAL da linha (nunca o da migração).
--     `submitted_at` é o melhor proxy disponível da última atividade histórica.
UPDATE responses
   SET last_activity_at = submitted_at
 WHERE last_activity_at IS NULL
   AND submitted_at IS NOT NULL;

-- 1c) SÓ AGORA o default — passa a valer apenas para linhas NOVAS.
ALTER TABLE responses ALTER COLUMN last_activity_at SET DEFAULT now();

-- 2) Claim ATÔMICA do alerta de abandono: 1 por response, garantido pelo banco.
--    Fecha a corrida SELECT->INSERT entre duas instâncias do cron. O ciclo de
--    vida pendente/enviado é construído em cima disto pelo código:
--    `wacli_message_id IS NULL` = PENDENTE (lease em created_at);
--    preenchido = ENVIADO.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_abandoned_alert_per_response
  ON form_whatsapp_logs (response_id) WHERE status = 'abandoned_alert';

-- 2b) UMA parcial incompleta por (usuário, form) — P2-5 da 2ª auditoria.
--     Dois PUTs simultâneos de autosave podiam AMBOS não achar parcial e
--     inserir, deixando DUAS rows incompletas: uma é completada pelo submit e a
--     OUTRA fica órfã e vira falso "lead abandonado" pro cron. O índice faz o
--     perdedor receber 23505, e o código adota a row do vencedor.
--     (Só vale pro caminho autenticado; parcial anônima tem respondent_id NULL
--      e é desduplicada por partial_session_hash.)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_parcial_incompleta_por_usuario_form
  ON responses (respondent_id, form_id)
  WHERE completed = false AND respondent_id IS NOT NULL;

-- 3) Default NOVO do template de mensagem (o default velho ainda mora no banco;
--    o código já cobre, mas rota que omite message_template herdaria o velho).
ALTER TABLE form_whatsapp_settings ALTER COLUMN message_template SET DEFAULT
  E'🔔 *Novo lead* em {form_name}\n\n{respostas}\n\n💬 Responder: {whatsapp_link}\n🕒 Recebido {data} às {horario}\n*Eventos Meta:* {meta_events}';
