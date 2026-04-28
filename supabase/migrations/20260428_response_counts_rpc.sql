-- Migration: RPC to get response counts per form IDs efficiently
-- Replaces loading all responses into memory in handleDowngrade

CREATE OR REPLACE FUNCTION get_response_counts_by_forms(p_form_ids uuid[])
RETURNS TABLE(form_id uuid, response_count bigint) AS $$
BEGIN
  RETURN QUERY
  SELECT r.form_id, COUNT(*)::bigint AS response_count
  FROM responses r
  WHERE r.form_id = ANY(p_form_ids)
  GROUP BY r.form_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
