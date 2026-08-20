-- =============================================================================
-- CAPI: eventos de qualificação disparam NO MEIO do preenchimento (18/08/2026)
-- =============================================================================
-- DECISÃO DO SIDNEY, revertendo a recomendação anterior: "se o lead é
-- qualificado, não importa se não terminou o form — o que importa é que é
-- qualificado". Faz sentido NESTE produto: a resposta parcial fica salva e o
-- alerta de lead incompleto existe, então o qualificado que abandona É um lead
-- trabalhável. A função passa a aceitar enfileiramento no salvamento PARCIAL.
--
-- O que segura cada risco:
--   · cardinalidade: UNIQUE (response_id, trigger_id) — disparou uma vez, nunca
--     de novo, mesmo com 50 autosaves seguidos;
--   · conclusão: o gatilho 'complete' SÓ entra quando p_completed = true
--     (guarda nova no INSERT, defesa em profundidade sobre a rota);
--   · quem decide QUAIS eventos continua sendo a rota, derivando das respostas
--     que o SERVIDOR gravou — nada vem de lista do navegador.
--
-- ⚠️ Rodar UMA VEZ pelo SQL Editor. CREATE OR REPLACE preserva dono e grants,
--    mas o REVOKE/GRANT é reaplicado por segurança (idempotente).
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
-- QUEM CHAMA VALIDA (publicação, plano, cota): app/api/responses/route.ts, único
-- chamador, via service_role. Esta função garante UMA coisa: gravar a resposta e
-- enfileirar os eventos juntos, ou nenhum dos dois.
DECLARE
  v_gravada   boolean := false;
  v_resposta  public.responses%ROWTYPE;
  v_eventos   jsonb;
BEGIN
  -- CAS: `completed = false` no WHERE. Autosave parcial grava repetidas vezes
  -- (p_completed=false mantém a linha aberta); a CONCLUSÃO só acontece uma vez.
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

  v_gravada := FOUND;

  -- MUDANÇA DESTA VERSÃO: enfileira também no salvamento PARCIAL — é assim que o
  -- evento de qualificação dispara no meio do preenchimento. A repetição de
  -- autosave não duplica nada: ON CONFLICT + UNIQUE seguram a cardinalidade.
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
    -- Defesa em profundidade: CONCLUSÃO não entra por autosave parcial, mesmo
    -- que um bug futuro da rota a inclua na lista.
    WHERE (e.trigger_id <> 'complete' OR p_completed)
    ON CONFLICT (response_id, trigger_id) DO NOTHING;
  END IF;

  -- Devolve TODAS as linhas da resposta (novas e antigas). O navegador compara
  -- com o que já disparou e dispara só o que falta; o já-concluído recebe os
  -- MESMOS event_id de sempre — nunca se rederiva um snapshot.
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
    'metaEvents',     COALESCE(to_jsonb(v_resposta.meta_events), '[]'::jsonb),
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
  '20260818_capi_outbox_parciais',
  'Funcao passa a enfileirar no salvamento parcial (qualificacao no meio do form); gatilho complete so com p_completed',
  ARRAY[
    'CREATE OR REPLACE promover_resposta_e_enfileirar_capi: enfileira em parciais, guarda WHERE trigger_id <> complete OR p_completed',
    'REVOKE/GRANT reaplicados (so service_role executa)'
  ]
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
