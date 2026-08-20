-- =============================================================================
-- Fila de entrega do CAPI + promoção ATÔMICA da resposta (18/08/2026)
-- =============================================================================
-- DOIS DEFEITOS QUE ISTO FECHA, ambos de parecer independente:
--
-- 1. ENTREGA QUE SOME. Hoje, se o envio ao Meta falha (Meta fora do ar, rede,
--    token vencido), o evento é perdido em silêncio: sem retentativa, sem alerta,
--    sem registro. A vitrine chegou a prometer confiabilidade que o código não
--    tinha — a promessa foi recolhida em `7342ff2`.
--
-- 2. JANELA ENTRE PROMOVER E ENFILEIRAR. A resposta vira `completed` num UPDATE e
--    a fila seria outro comando. Se o segundo falhasse, o evento se perderia
--    para sempre — o CAS impede um novo submit de promover de novo. Por isso a
--    função abaixo faz as DUAS coisas: corpo de função roda em UMA transação.
--
-- ⚠️ Rodar UMA VEZ pelo SQL Editor. Atômico, registra a própria migração.
-- ⚠️ NADA muda de comportamento: a tabela nasce vazia e o código no ar ainda não
--    conhece nem a tabela nem a função.
-- =============================================================================

BEGIN;

-- ── 1. A FILA ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.capi_outbox (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id  uuid NOT NULL REFERENCES public.responses(id) ON DELETE CASCADE,
  form_id      uuid NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,

  -- Identidade do GATILHO, não do nome do evento: 'complete', 'answerset:<id>',
  -- 'question:<questionId>:<ruleId>'. É a chave que torna a cardinalidade uma
  -- propriedade do banco — um gatilho, uma linha, por resposta. Sem isto, a
  -- contagem voltaria a depender do que o navegador (ou um POST forjado) alega.
  trigger_id   text NOT NULL,

  -- ── SNAPSHOT IMUTÁVEL ────────────────────────────────────────────────────
  -- O payload é congelado no momento da conclusão. O dono pode editar perguntas,
  -- regras, valores e até o Pixel depois; uma retentativa amanhã NÃO pode enviar
  -- o evento de ontem com a configuração de hoje.
  pixel_id         text NOT NULL,
  event_name       text NOT NULL,
  event_id         text NOT NULL,   -- o MESMO em toda retentativa: é o que deduplica
  event_time       timestamptz NOT NULL,
  value            numeric,
  currency         text,
  action_source    text NOT NULL DEFAULT 'website',
  event_source_url text,
  -- PII já NORMALIZADA E HASHEADA (SHA-256). Nunca em claro. Some junto com a
  -- resposta pelo ON DELETE CASCADE acima — a exclusão do lead alcança a fila.
  user_data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  test_event_code  text,
  payload_version  smallint NOT NULL DEFAULT 1,

  -- ⚠️ O TOKEN NÃO ENTRA AQUI. Ele é lido de `form_capi_credentials` na hora do
  -- envio, e só é usado se o `pixel_id` da credencial ainda for exatamente igual
  -- ao desta linha — evento antigo nunca vai para um Pixel novo.

  -- ── ESTADO ───────────────────────────────────────────────────────────────
  -- 'blocked_auth' existe separado de 'dead' de propósito: token revogado não
  -- torna o evento inválido, torna a CONFIGURAÇÃO corrigível. Essas linhas param
  -- de ser tentadas de hora em hora e voltam à fila quando um token novo for
  -- salvo para o mesmo Pixel.
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','sent','retryable','blocked_auth','dead','expired')),
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  last_attempt_at timestamptz,
  sent_at         timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),

  -- Derivado do EVENT_TIME, não do created_at: o Meta recusa o lote inteiro se
  -- algum evento passar de 7 dias. Depois disso a linha morre como 'expired'.
  expires_at      timestamptz NOT NULL,

  -- Lease do trabalhador, no mesmo molde do `dunning_outbox`: linha reservada que
  -- ficou órfã (processo morreu no meio) volta à fila quando o lease vence.
  lease_token uuid,
  leased_at   timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- ⭐ A INVARIANTE. Um gatilho gera no máximo UM evento por resposta, gravado
  -- na estrutura. É a defesa em profundidade sobre a derivação no servidor.
  CONSTRAINT capi_outbox_trigger_unico UNIQUE (response_id, trigger_id)
);

-- Consulta do trabalhador: o que está pronto para tentar agora.
CREATE INDEX IF NOT EXISTS idx_capi_outbox_a_enviar
  ON public.capi_outbox (next_attempt_at)
  WHERE status IN ('pending', 'retryable');

-- Recuperação de lease órfão.
CREATE INDEX IF NOT EXISTS idx_capi_outbox_processando
  ON public.capi_outbox (leased_at)
  WHERE status = 'processing';

-- Religar o que ficou preso por token revogado, quando a credencial for trocada.
CREATE INDEX IF NOT EXISTS idx_capi_outbox_bloqueado
  ON public.capi_outbox (form_id, pixel_id)
  WHERE status = 'blocked_auth';

ALTER TABLE public.capi_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.capi_outbox FROM PUBLIC;
REVOKE ALL ON public.capi_outbox FROM anon;
REVOKE ALL ON public.capi_outbox FROM authenticated;
GRANT ALL ON public.capi_outbox TO service_role;

COMMENT ON TABLE public.capi_outbox IS
  'Fila de entrega do Meta CAPI. Snapshot imutavel por (resposta, gatilho); o event_id persistido e reusado em toda retentativa, que e o que impede contagem dupla.';

-- ── 2. PROMOVER A RESPOSTA E ENFILEIRAR, NA MESMA TRANSAÇÃO ─────────────────
CREATE OR REPLACE FUNCTION public.promover_resposta_e_enfileirar_capi(
  p_response_id  uuid,
  p_form_id      uuid,
  p_answers      jsonb,
  p_meta_events  text[],
  p_completed    boolean,
  p_last_question text,
  p_utm_source   text,
  p_utm_medium   text,
  p_utm_campaign text,
  p_utm_term     text,
  p_utm_content  text,
  p_url_params   jsonb,
  p_eventos      jsonb   -- array dos gatilhos derivados PELO SERVIDOR
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
-- ⚠️ QUEM CHAMA VALIDA. Esta função é SECURITY DEFINER e NÃO confere se o formulário
-- está publicado, se o plano permite, nem se a cota foi respeitada — tudo isso já
-- acontece em `app/api/responses/route.ts` antes da chamada. Ela existe para uma coisa
-- só: garantir que promover a resposta e enfileirar os eventos aconteçam juntos ou não
-- aconteçam. Só o service_role executa (GRANT no fim do arquivo).
DECLARE
  v_promovida  boolean := false;
  v_resposta   public.responses%ROWTYPE;
  v_eventos    jsonb;
BEGIN
  -- CAS: só um submit promove. Mesma semântica do UPDATE que isto substitui.
  UPDATE public.responses SET
    answers                = COALESCE(p_answers, answers),
    meta_events            = COALESCE(p_meta_events, meta_events),
    completed              = p_completed,
    last_question_answered = p_last_question,
    utm_source             = p_utm_source,
    utm_medium             = p_utm_medium,
    utm_campaign           = p_utm_campaign,
    utm_term               = p_utm_term,
    utm_content            = p_utm_content,
    url_params             = COALESCE(p_url_params, url_params)
  WHERE id = p_response_id
    AND form_id = p_form_id
    AND completed = false
  RETURNING * INTO v_resposta;

  v_promovida := FOUND;

  -- Enfileira SÓ quem promoveu E SÓ na CONCLUSÃO. Esta rota também grava salvamento
  -- PARCIAL (a resposta continua `completed = false` e o CAS casa do mesmo jeito) —
  -- sem o `p_completed` aqui, cada autosave enfileiraria conversão de um formulário
  -- que o lead ainda está preenchendo.
  IF v_promovida AND p_completed AND p_eventos IS NOT NULL AND jsonb_array_length(p_eventos) > 0 THEN
    INSERT INTO public.capi_outbox (
      response_id, form_id, trigger_id, pixel_id, event_name, event_id, event_time,
      value, currency, action_source, event_source_url, user_data, test_event_code, expires_at
    )
    SELECT
      p_response_id, p_form_id,
      e.trigger_id, e.pixel_id, e.event_name, e.event_id,
      COALESCE(e.event_time, now()),
      e.value, e.currency,
      COALESCE(e.action_source, 'website'), e.event_source_url,
      COALESCE(e.user_data, '{}'::jsonb), e.test_event_code,
      -- 7 dias a partir do EVENT_TIME: é o limite que o Meta impõe.
      COALESCE(e.event_time, now()) + interval '7 days'
    FROM jsonb_to_recordset(p_eventos) AS e(
      trigger_id text, pixel_id text, event_name text, event_id text,
      event_time timestamptz, value numeric, currency text,
      action_source text, event_source_url text, user_data jsonb, test_event_code text
    )
    -- A invariante já protege; o DO NOTHING evita explodir numa retentativa do POST.
    ON CONFLICT (response_id, trigger_id) DO NOTHING;
  END IF;

  -- Devolve SEMPRE as linhas gravadas — inclusive quando não promoveu. É isto que
  -- faz o já-concluído reusar o snapshot em vez de rederivar com a configuração
  -- de agora: o navegador recebe os MESMOS event_id da primeira vez.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'triggerId', o.trigger_id,
    'eventName', o.event_name,
    'eventId',   o.event_id,
    'value',     o.value,
    'currency',  o.currency
  ) ORDER BY o.created_at), '[]'::jsonb)
  INTO v_eventos
  FROM public.capi_outbox o
  WHERE o.response_id = p_response_id;

  RETURN jsonb_build_object(
    'promovida',    v_promovida,
    'responseId',   p_response_id,
    'submittedAt',  v_resposta.submitted_at,
    'sheetsRowIndex', v_resposta.sheets_row_index,
    'metaEvents',   COALESCE(to_jsonb(v_resposta.meta_events), '[]'::jsonb),
    'browserEvents', v_eventos
  );
END;
$$;

-- SECURITY DEFINER: fechar para todos e liberar só ao service_role. Sem isto,
-- `anon` poderia executar a função e promover resposta alheia — foi exatamente
-- este o achado nº 2 da auditoria de agosto (REGRA Nº 1 do CLAUDE.md).
REVOKE ALL ON FUNCTION public.promover_resposta_e_enfileirar_capi(
  uuid, uuid, jsonb, text[], boolean, text, text, text, text, text, text, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promover_resposta_e_enfileirar_capi(
  uuid, uuid, jsonb, text[], boolean, text, text, text, text, text, text, jsonb, jsonb
) TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20260818_capi_outbox',
  'Fila de entrega do CAPI + promocao atomica da resposta',
  ARRAY[
    'CREATE TABLE public.capi_outbox com UNIQUE (response_id, trigger_id), snapshot imutavel e estado de fila',
    'Indices: a_enviar (parcial), processando (lease orfao), bloqueado (por form+pixel)',
    'RLS on, REVOKE ALL de PUBLIC/anon/authenticated, GRANT ALL a service_role',
    'CREATE FUNCTION promover_resposta_e_enfileirar_capi SECURITY DEFINER, execute so a service_role'
  ]
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
