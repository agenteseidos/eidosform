-- Migração MANUAL — Alerta de LEAD ABANDONADO por E-MAIL (Entrega 2).
-- Aplicar no SQL Editor do Supabase. NÃO é destrutiva: só cria objetos novos.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- QUAL É O PROBLEMA
--
-- O aviso de "alguém começou a preencher e parou" existe só por WhatsApp, e o
-- WhatsApp saiu do produto em 2026-07-30 (restrição de 6h da linha). Ou seja:
-- hoje NENHUM cliente pagante recebe esse alerta. Este arquivo cria o que falta
-- para o mesmo alerta sair por e-mail.
--
-- POR QUE UMA TABELA NOVA, E NÃO REUSAR form_whatsapp_logs
--
-- O cron de WhatsApp marca "já avisei este lead" inserindo uma linha em
-- form_whatsapp_logs com status='abandoned_alert', protegida pelo índice único
-- `uniq_abandoned_alert_per_response` (UM alerta por resposta). Se o e-mail
-- dividisse esse mesmo marcador, enviar o e-mail faria o WhatsApp acreditar que
-- já avisou — e vice-versa. Um canal cancelaria o outro em silêncio.
--
-- Além disso o marcador do WhatsApp é por RESPOSTA, e o e-mail precisa ser por
-- DESTINATÁRIO: uma resposta pode gerar dois e-mails legítimos (o dono da conta
-- e o endereço extra configurado em Integrações). Marcar só por canal
-- bloquearia o segundo para sempre.
--
-- POR QUE É SEGURA
--
--  * Cria tabela e índices NOVOS; não altera nem apaga nada existente.
--  * Não mexe em form_whatsapp_logs — o cron de WhatsApp continua idêntico.
--  * `IF NOT EXISTS` em tudo: rodar duas vezes não quebra.
--  * A tabela nasce com RLS LIGADA e sem política de escrita pública — só o
--    service_role (servidor) escreve; o dono do formulário só LÊ o que é dele.
--  * Nenhum e-mail em claro: guardamos um HASH do destinatário. Dá para auditar
--    "este endereço já foi avisado?" sem armazenar o endereço.
--
-- O QUE MUDA DEPOIS DE RODAR
--
-- Nada sozinho. O código só passa a alertar quando a migração existir E o
-- endpoint novo estiver agendado (ver DEPLOY.md). Sem a tabela, o cron novo
-- falha fechado (não envia nada) em vez de mandar alerta duplicado.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) REGISTRO/CLAIM das notificações por canal e destinatário.
--
--    O ciclo de vida é explícito na coluna `status` (o cron de WhatsApp deduz o
--    dele de `wacli_message_id IS NULL`, que já se provou ambíguo):
--      pending = claim adquirido, envio ainda não confirmado (lease em created_at)
--      sent    = entregue ao provedor (provider_message_id preenchido)
--      failed  = falha terminal; NÃO é retentado (o sender já tentou 3x por
--                conta própria). Evita o "martelo" que gerou 35 tentativas no
--                mesmo lead em 27/07.
CREATE TABLE IF NOT EXISTS form_notification_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id      uuid NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  form_id          uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  -- 'new_response' já é aceito para que a fila durável do e-mail de resposta
  -- completa (hoje inexistente) caiba aqui depois, SEM redesenho.
  event_type       text NOT NULL CHECK (event_type IN ('new_response', 'abandoned')),
  -- Nasce preparada para outros canais; hoje só 'email' é escrito pelo código.
  channel          text NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'whatsapp')),
  recipient_role   text NOT NULL CHECK (recipient_role IN ('owner', 'form_email')),
  -- sha256 do e-mail normalizado (trim + minúsculas). NUNCA o endereço.
  recipient_hash   text NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts         integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  provider_message_id text,
  error_message    text
);

-- 2) CLAIM ATÔMICO por destinatário. É este índice que fecha a corrida entre
--    duas execuções simultâneas do cron: o perdedor recebe 23505 e desiste.
--
--    Por destinatário (e não só por canal) porque dono e endereço extra são
--    dois avisos legítimos. Quando os dois normalizam para o MESMO e-mail, o
--    código deduplica ANTES de criar o claim — então existe um só.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_notification_per_recipient
  ON form_notification_logs (response_id, event_type, channel, recipient_role);

-- 3) Busca dos claims de um lote de respostas (o cron pergunta "quais destes
--    já foram avisados?" a cada página da varredura).
CREATE INDEX IF NOT EXISTS idx_notification_logs_lookup
  ON form_notification_logs (event_type, channel, response_id);

-- 4) ÍNDICE DA VARREDURA DE ABANDONO.
--
--    A consulta do cron é, em essência:
--        SELECT ... FROM responses
--         WHERE completed = false
--           AND last_activity_at >= <cursor> AND last_activity_at < <corte>
--           AND form_id IN (<forms elegíveis>)
--         ORDER BY last_activity_at ASC
--         LIMIT 50;
--
--    Hoje existem só `idx_responses_form_id` e `idx_responses_submitted_at` —
--    nenhum serve. Sem índice, ampliar a base varrida (o alerta por e-mail vê
--    MUITO mais formulários que o de WhatsApp) é risco real de custo e de
--    timeout no timer de 15 min.
--
--    `last_activity_at` vem PRIMEIRO de propósito: é ele que a consulta filtra
--    por FAIXA e usa para ORDENAR, então o índice devolve as linhas já na ordem
--    do cursor e o banco não precisa ordenar nada. Pôr `form_id` na frente
--    pareceria natural, mas obrigaria a ordenar cada grupo e juntar depois — e
--    fica pior à medida que mais clientes Plus entram (a lista de formulários
--    elegíveis cresce e deixa de ser seletiva).
--
--    Parcial (`WHERE completed = false`): respostas completas são a esmagadora
--    maioria e nunca entram nesta busca. O índice fica pequeno e barato.
CREATE INDEX IF NOT EXISTS idx_responses_abandono_scan
  ON responses (last_activity_at, id)
  WHERE completed = false;

-- 5) SEGURANÇA: só o servidor escreve; o dono lê o que é dele.
ALTER TABLE form_notification_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_writes_notification_logs" ON form_notification_logs;
CREATE POLICY "service_role_writes_notification_logs" ON form_notification_logs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "owners_read_notification_logs" ON form_notification_logs;
CREATE POLICY "owners_read_notification_logs" ON form_notification_logs
  FOR SELECT TO authenticated
  USING (form_id IN (SELECT id FROM forms WHERE user_id = auth.uid()));

-- Sem nenhuma política para `anon`: visitante não lê nem escreve.


-- ─────────────────────────────────────────────────────────────────────────────
-- 6) CONFERÊNCIA (opcional, mas o plano pede) — rode DEPOIS dos passos acima e
--    me mande a saída. É só leitura, não altera nada.
--
--    O que procurar no resultado: as linhas devem mencionar
--    `Index Scan using idx_responses_abandono_scan`. Se aparecer `Seq Scan`
--    (varredura da tabela inteira) ou um `Sort` no topo, o índice escolhido
--    está errado para o formato real da consulta e eu troco a ordem das
--    colunas. Números pequenos agora são esperados (a base é pequena); o que
--    importa é QUAL caminho o banco escolheu, não o tempo.
--
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT id, form_id, last_activity_at
--   FROM responses
--  WHERE completed = false
--    AND last_activity_at >= now() - interval '72 hours'
--    AND last_activity_at <  now() - interval '30 minutes'
--  ORDER BY last_activity_at ASC
--  LIMIT 50;
--
--    E a versão com o filtro de formulários (troque os UUIDs por 2–3 ids reais
--    de formulários seus, ou apague a linha do IN para ver só a faixa):
--
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT id, form_id, last_activity_at
--   FROM responses
--  WHERE completed = false
--    AND last_activity_at >= now() - interval '72 hours'
--    AND last_activity_at <  now() - interval '30 minutes'
--    AND form_id IN ('00000000-0000-0000-0000-000000000000')
--  ORDER BY last_activity_at ASC
--  LIMIT 50;
-- ─────────────────────────────────────────────────────────────────────────────
