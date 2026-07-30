-- Painel admin 2026-07-30 — journal append-only de ações administrativas.
--
-- Etapa 3 do plano aprovado pelo Sidney (parecer Codex incorporado): TODA
-- mutação feita pelo painel admin registra quem/o quê/antes/depois/por quê.
-- Para operações puramente locais o estado nasce 'completed'. Quando a Fase 4
-- (sincronização com o Asaas) chegar, esta MESMA tabela vira o journal da
-- operação distribuída — por isso os estados intermediários já existem.
--
-- Append-only por privilégio: só service_role escreve; ninguém edita/apaga
-- pelas roles comuns. Sem hash chain/WORM (decisão Codex: desnecessário agora).
-- NUNCA gravar token de cartão ou payload sensível em before/after.

CREATE TABLE IF NOT EXISTS public.admin_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT UNIQUE,
  actor_id UUID NOT NULL,
  actor_email TEXT NOT NULL,           -- snapshot: sobrevive se o admin sair
  target_user_id UUID NOT NULL,
  target_email TEXT,                   -- snapshot: sobrevive se a conta for apagada
  action TEXT NOT NULL,                -- ex.: plan_change | expiry_adjust | account_delete
  reason TEXT NOT NULL,                -- motivo obrigatório (decisão Sidney 30/07)
  state TEXT NOT NULL DEFAULT 'completed'
    CHECK (state IN ('requested','provider_applied','local_applied','completed','failed','reconcile_required')),
  before JSONB,
  after JSONB,
  subscription_id TEXT,
  payment_id TEXT,
  attempts INT NOT NULL DEFAULT 1,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_target
  ON public.admin_actions (target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_actions_state
  ON public.admin_actions (state)
  WHERE state IN ('failed','reconcile_required');

ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;
-- Sem policies para anon/authenticated: só service_role (bypassa RLS) escreve/lê.
REVOKE ALL ON TABLE public.admin_actions FROM anon, authenticated;

COMMENT ON TABLE public.admin_actions IS
  'Journal append-only das ações do painel admin. Estados intermediários reservados para operações que tocam o Asaas (Fase 4).';
