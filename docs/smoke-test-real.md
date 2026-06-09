# Smoke test com dinheiro REAL — EidosForm / Asaas

> Objetivo: **gastar R$49 uma vez e sair com confiança** de que produção funciona — não "ir vendo".
> Preços REAIS de hoje (NÃO mexer em `PLAN_PRICES`). Plano: Starter mensal.
> Provar o que o sandbox não prova: (a) cartão real tokeniza, (b) cobrança real, (c) estorno real, (d) webhook de produção.

## Ferramenta de observação — o inspetor
Painel único do estado de um cliente (profile + checkouts + eventos + subs Asaas + pagamentos + veredito de limpeza):
```bash
# snapshot
ENV_FILE=.env.production.local node scripts/billing-inspect.mjs <email>
# acompanhar ao vivo (loop 4s) durante o teste
ENV_FILE=.env.production.local node scripts/billing-inspect.mjs <email> --watch
# auditoria de limpeza pós-teste (PASS/FAIL)
ENV_FILE=.env.production.local node scripts/billing-inspect.mjs <email> --cleanup
```
> ⚠️ `.env.production.local` é gerado com `vercel env pull` e **NUNCA** é commitado.

---

## FASE 0 — Ensaiar tudo no SANDBOX (sem gastar nada)
- [x] **0.2 — `description` persistida na sub?** → **SIM** (confirmado 2026-06-09: `desc="EidosForm — Plano starter (Mensal)"`). Rede de segurança do webhook OK.
- [x] **0.5 — Inspetor pronto** (`scripts/billing-inspect.mjs`) — funciona sandbox e prod.
- [ ] **0.1 — Dry-run do ESTORNO** no sandbox: comprar → estornar no painel Asaas → confirmar via inspetor que o evento `PAYMENT_REFUNDED` chegou e que **o acesso NÃO caiu por engano** (refund só alerta, não rebaixa) e a sub não segue viva.
- [ ] **0.3 — Ensaiar reativação via token** no sandbox: comprar → cancelar → reassinar (sem digitar cartão) → confirmar sub nova com `nextDue` futuro.
- [ ] **0.4 — Ensaiar a LIMPEZA formal** (checklist abaixo) no sandbox, pra ter o passo a passo na mão.

## FASE 1 — Preparar produção (SEM comprar nada)
- [ ] `CRON_SECRET` forte setado na Vercel.
- [ ] Chaves de **produção** do Asaas em mãos.
- [ ] **Tokenização ATIVA** confirmada com o Asaas na conta de produção.
- [ ] **Taxa/prazo de estorno** confirmados com o Asaas (custo líquido real do teste).
- [ ] **Webhook de produção** registrado + secret correto + **rejeita evento sem assinatura válida** (barreira de auth).
- [ ] Conta de teste limpa (profile=free, sem subs/pending).
- [ ] `ENV_FILE=.env.production.local` puxado e o inspetor rodando contra a conta de teste.
- [ ] **Virar `ASAAS_ENVIRONMENT=production`** + chaves prod → deploy.

## FASE 2 — Teste real ÚNICO (Starter mensal, R$49)
1. [ ] **Comprar Starter mensal** com cartão real → inspetor: 1 sub ACTIVE R$49, checkout `paid`, `asaas_card_token` capturado, plano ativo.
2. [ ] **Cancelar pelo app** → inspetor: sub vira INACTIVE/`canceling`, expiração coerente pela pending.
3. [ ] **Reativar via token** (Starter mensal, cobrança futura) → inspetor: sub nova com `nextDue` futuro, **sem cobrar agora**.
4. [ ] **Cancelar a NOVA sub imediatamente** (evita 2ª cobrança futura).
5. [ ] **Estornar a cobrança original (R$49)** — ordem segura abaixo.
6. [ ] **Limpar o profile** pra free (se necessário).

## FASE 3 — Auditoria pós-teste
- [ ] `... --cleanup` retorna **✅ PASS** (todos os checks verdes).
- [ ] Asaas: **0 subs ACTIVE**, **0 pagamentos PENDING/OVERDUE** inesperados, pagamento original **REFUNDED**.
- [ ] Supabase: profile=free, `asaas_subscription_id`=null, coerente.
- [ ] **0 eventos `failed`/dead** não explicados; **0 locks** ativos.

---

## 🧹 Checklist de LIMPEZA (ordem que evita 2ª cobrança)
> Estorno **não** rebaixa o plano sozinho (só alerta). A limpeza é manual e nesta ordem:

1. **Cancelar a assinatura** (pelo app, ou DELETE no painel Asaas).
2. **Confirmar ZERO subs ACTIVE** para o customer (inspetor: `ASAAS SUBS: ⚪ 0 ACTIVE`).
3. **Estornar** o pagamento confirmado (painel Asaas → pagamento → Estornar).
4. **Confirmar o refund** (inspetor: pagamento `[REFUNDED]` + evento `PAYMENT_REFUNDED` chegou, sem DLQ).
5. **Forçar o profile para free**, se ainda não voltou (query abaixo).
6. **Rodar `--cleanup`** e exigir **✅ PASS**.

### Queries de inspeção/limpeza (Supabase SQL Editor)
```sql
-- Estado do profile de teste
select id, email, plan, plan_cycle, plan_status, plan_expires_at,
       asaas_customer_id, asaas_subscription_id, responses_used, responses_limit
from profiles where email = 'EMAIL_DE_TESTE';

-- Últimos checkouts do teste
select checkout_id, plan, cycle, status, last_event, asaas_subscription_id, created_at
from billing_checkouts
where profile_id = (select id from profiles where email = 'EMAIL_DE_TESTE')
order by created_at desc limit 10;

-- Eventos de webhook problemáticos (DLQ) / locks / align-formlimit
select event_id, event, status, error, attempts, processed_at
from asaas_webhook_events
where status = 'failed'
   or event_id like 'lock:%' or event_id like 'align-pending:%' or event_id like 'formlimit:%'
order by processed_at desc limit 20;

-- FORÇAR profile de teste para free (rodar só na LIMPEZA, com o email certo)
update profiles
set plan = 'free', plan_cycle = null, plan_status = 'free',
    plan_expires_at = null, asaas_subscription_id = null,
    responses_limit = 100, responses_used = 0, limit_alert_sent = false
where email = 'EMAIL_DE_TESTE';
```

---

## ⚠️ Verdade sobre o ROLLBACK
Voltar `ASAAS_ENVIRONMENT=sandbox` **NÃO** cancela sub real, **NÃO** estorna pagamento real, **NÃO** desfaz evento pendente. O rollback de verdade é, nesta ordem: **cancelar subs reais → estornar pagamentos reais → confirmar Asaas limpo (`--cleanup` PASS) → só então mexer em env.**
