-- =============================================================================
-- HOTFIX: a RPC quebrava TODO submit — meta_events é JSONB no banco (20/08/2026)
-- =============================================================================
-- O QUE ACONTECEU: `promover_resposta_e_enfileirar_capi` fazia
-- `meta_events = COALESCE(p_meta_events, meta_events)` com p_meta_events text[].
-- No banco REAL a coluna `responses.meta_events` é JSONB (conferido pelo
-- OpenAPI/catálogo em 20/08) — o repositório e o database.types.ts diziam
-- text[]/string[]. O planner recusa COALESCE(text[], jsonb) → erro 42804 → a
-- rota devolvia "Erro ao salvar resposta" para TODO envio desde o deploy de
-- 19/08 ~22h40. (Impacto real medido: zero leads perdidos — só os testes.)
--
-- É A REGRA Nº 1 DO CLAUDE.md SE COBRANDO: o repositório NÃO descreve o banco.
-- A função nasceu confiando no tipo do types gerado, não no catálogo.
--
-- O conserto: to_jsonb() no parâmetro. to_jsonb é STRICT — parâmetro NULL
-- devolve NULL e o COALESCE preserva o valor existente, como antes.
-- ⚠️ Rodar UMA VEZ pelo SQL Editor.
-- =============================================================================

BEGIN;

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
  p_eventos      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gravada   boolean := false;
  v_resposta  public.responses%ROWTYPE;
  v_eventos   jsonb;
BEGIN
  UPDATE public.responses SET
    answers                = COALESCE(p_answers, answers),
    -- ⚠️ A LINHA DO HOTFIX: a coluna é JSONB no banco real; o parâmetro é text[].
    meta_events            = COALESCE(to_jsonb(p_meta_events), meta_events),
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

  v_gravada := FOUND;

  IF v_gravada AND p_eventos IS NOT NULL AND jsonb_array_length(p_eventos) > 0 THEN
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
      COALESCE(e.event_time, now()) + interval '7 days'
    FROM jsonb_to_recordset(p_eventos) AS e(
      trigger_id text, pixel_id text, event_name text, event_id text,
      event_time timestamptz, value numeric, currency text,
      action_source text, event_source_url text, user_data jsonb, test_event_code text
    )
    WHERE (e.trigger_id <> 'complete' OR p_completed)
    ON CONFLICT (response_id, trigger_id) DO NOTHING;
  END IF;

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
    'promovida',      v_gravada,
    'responseId',     p_response_id,
    'submittedAt',    v_resposta.submitted_at,
    'sheetsRowIndex', v_resposta.sheets_row_index,
    'metaEvents',     COALESCE(v_resposta.meta_events, '[]'::jsonb),
    'browserEvents',  v_eventos
  );
END;
$$;

REVOKE ALL ON FUNCTION public.promover_resposta_e_enfileirar_capi(
  uuid, uuid, jsonb, text[], boolean, text, text, text, text, text, text, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promover_resposta_e_enfileirar_capi(
  uuid, uuid, jsonb, text[], boolean, text, text, text, text, text, text, jsonb, jsonb
) TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20260820_capi_rpc_meta_events_jsonb',
  'HOTFIX: meta_events e JSONB no banco real; COALESCE(text[], jsonb) quebrava todo submit',
  ARRAY['CREATE OR REPLACE promover_resposta_e_enfileirar_capi: to_jsonb(p_meta_events) no SET e retorno sem to_jsonb']
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
