# Auditoria: Features de Venda e Conversão — EidosForm

**Data:** 2026-04-22
**Agente:** Zéfa
**Escopo:** Mapear features de conversão, identificar gaps, classificar por impacto comercial.

---

## Resumo Executivo

O EidosForm tem uma base sólida de features técnicas (pixels, webhooks, billing), mas **carece de features essenciais de distribuição e profissionalização** que compradores esperam. Os maiores gaps não são técnicos — são comerciais: embed, white-label completo, e exportação avançada. Um prospect que compara com Typeform/Tally vai notar essas ausências imediatamente.

---

## 1. Features de Conversão — Estado Atual

### 1.1 Pixels & Tracking

| Feature | Status | Detalhe |
|---------|--------|---------|
| Meta Pixel | ✅ Completo | Server-side init, client events, 18 eventos padrão |
| Google Ads (gtag) | ✅ Completo | Conversão via `send_to` |
| TikTok Pixel | ✅ Completo | ViewContent + SubmitForm |
| Google Tag Manager | ✅ Completo | dataLayer push |
| UTM Tracking | ✅ Completo | Captura + persistência (30 dias) + salva com resposta |
| Eventos condicionais por resposta | ✅ Completo | 8 operadores (equals, contains, gt, lt, etc.) |
| **Meta CAPI (server-side)** | ❌ Ausente | ~20-40% de conversões perdidas por ad-blockers |
| **GA4** | ❌ Ausente | Apenas Ads, sem analytics geral |
| **UTM → Pixel attribution** | ❌ Ausente | UTM capturado mas não enviado nos eventos pixel |
| **Deduplicação CAPI+Pixel** | ❌ Ausente | |

**Bugs:**
- TikTok `page()` disparado 2x (duplicado)
- UTM session/local storage usam mesma key (sobrescrevem)
- `pixel-event-engine.ts` é código morto (duplica `pixel-events.ts`)
- Eventos pixel falham silenciosamente se não carregam

### 1.2 Webhooks & Integrações

| Feature | Status | Detalhe |
|---------|--------|---------|
| Webhook de resposta (outgoing) | ✅ Completo | 4 retries, 10s timeout, SSRF protection |
| Validação de URL (HTTPS, sem IPs privados) | ✅ Completo | |
| Google Sheets (append rows) | ✅ Completo | Cria aba, headers, UTM |
| WhatsApp notificação | ✅ Completo | Via Evolution API |
| Email notificação (Resend) | ✅ Completo | Nova resposta, alertas de limite |
| Asaas (billing inbound) | ✅ Completo | 3 eventos (confirmed, overdue, deleted) |
| **Webhook HMAC/assinatura** | ❌ Ausente | Receptor não pode verificar autenticidade |
| **Múltiplos webhooks por form** | ❌ Ausente | Apenas 1 endpoint por form |
| **Logs de entrega de webhook** | ❌ Ausente | Falhas são server-only, user não vê |
| **Slack/Discord/Teams** | ❌ Ausente | |
| **Zapier/Make nativo** | ❌ Ausente | Webhook cobre parcialmente |
| **Regras de automação condicional** | ❌ Ausente | Sem triggers condicionais |

**Bugs:**
- **3 implementações de email duplicadas** (`notify.ts`, `email.ts`, `resend.ts`) — possível envio duplicado para usuário
- `integration-stubs.ts` e `form-integrations.ts` são cópias idênticas
- Comentário "1 tentativa" no webhook mas código faz 4 retries

### 1.3 Billing & Checkout

| Feature | Status | Detalhe |
|---------|--------|---------|
| 4 planos (Free, Starter, Plus, Pro) | ✅ Completo | Limites bem definidos |
| Checkout Asaas (cartão) | ✅ Completo | Hosted checkout |
| Webhook Asaas (ativação/cancelamento) | ✅ Completo | |
| Limites por plano (respostas, forms) | ✅ Completo | Server-side enforcement |
| Alerta 80% do limite | ✅ Completo | Email automático |
| **Boleto/PIX no checkout** | ❌ Ausente | Apenas cartão hardcoded |
| **Multi-user (Professional)** | ⚠️ Parcial | `maxUsers: 10` definido mas sem enforcement nem UI de gestão |
| **Feature gating** | ⚠️ Fraco | Maioria client-side, bypass possível |
| Data de ciclo hardcoded | 🐛 Bug | Usa `Date.now() + 32 dias` ao invés de `plan_expires_at` |

### 1.4 Distribuição & White-Label

| Feature | Status | Detalhe |
|---------|--------|---------|
| **Embed/iframe snippet** | ❌ **CRÍTICO — AUSENTE** | Zero implementação. Form player é full-page apenas |
| Domínio customizado | ✅ Completo | Vercel API, DNS CNAME, UI settings |
| Remover watermark | ✅ Completo | Plus+ |
| **Logo customizado (conta)** | ❌ Ausente | Welcome image é por-form, não por-conta |
| **Favicon customizado** | ❌ Ausente | |
| **Email sender customizado** | ❌ Ausente | |

### 1.5 Exportação

| Feature | Status | Detalhe |
|---------|--------|---------|
| CSV | ✅ Completo | Rate limited, BOM UTF-8, UTM |
| **PDF** | ❌ Ausente | |
| **Excel (.xlsx)** | ❌ Ausente | |
| **JSON** | ❌ Ausente | |
| **Google Sheets direto** | ⚠️ Parcial | Append funciona, mas não é "export" formal |

### 1.6 Outros Features de Conversão

| Feature | Status | Detalhe |
|---------|--------|---------|
| Templates (11) | ✅ Completo | Português, categorias, galeria |
| Onboarding (3 etapas) | ✅ Completo | Simples mas funcional |
| File upload (R2) | ✅ Completo | 10MB, JPEG/PNG/GIF/WebP/PDF |
| Lógica condicional (jump) | ✅ Completo | |
| Analytics (respostas, taxa, abandono) | ✅ Completo | API + básico |
| API v1 com key | ✅ Existe | Gating incerto |
| Coleta de pagamento | ❌ Ausente | Sem Stripe/ASAAS coleta no form |
| Multi-user/colaboração | ❌ Ausente | Vendido no Pro, não implementado |

---

## 2. Consistência Oferta vs Produto

| O que é vendido | O que funciona | Gap |
|-----------------|----------------|-----|
| 4 planos com limites claros | ✅ Limites enforced server-side | OK |
| Pixels (Plus+) | ✅ Funciona | Bugs menores |
| Webhooks (Plus+) | ✅ Funciona | Falta HMAC, logs, múltiplos |
| Domínio customizado (Pro) | ✅ Funciona | OK |
| White-label (Pro) | ⚠️ Parcial | Só remove watermark, sem branding próprio |
| 10 usuários (Pro) | ❌ Não implementado | Zero código de gestão de equipe |
| API access (Pro) | ⚠️ Incerto | Rota existe, gating não verificado |

---

## 3. Priorização por Impacto em Venda

### 🔴 CRÍTICO — Bloqueia venda para muitos prospects

| # | Feature | Justificativa |
|---|---------|---------------|
| 1 | **Embed/iframe snippet** | Feature #1 de qualquer form tool. Sem isso, prospect vai concorrente. Zero trabalho de distribuição = zero virality. |
| 2 | **Multi-user (Professional)** | Vendido como "para equipes" mas não existe. Risco de chargeback e churn. |
| 3 | **Consistência oferta×produto** | White-label incompleto e multi-user inexistente são promessas não cumpridas. |

### 🟠 ALTO — Impacta decisão de upgrade

| # | Feature | Justificativa |
|---|---------|---------------|
| 4 | **Exportação PDF/Excel** | CSV-only é dealbreaker para empresas. Export avançado é trigger de upgrade. |
| 5 | **Branding de conta** (logo, favicon, email sender) | White-label real, não só esconder marca. Diferencia Pro do Plus. |
| 6 | **PIX/Boleto no checkout** | Mercado brasileiro = PIX é essencial. Perder vendas sem isso. |
| 7 | **Meta CAPI** | Anunciantes Meta perdem 20-40% de conversões. Feature técnica que vendedores pedem. |
| 8 | **Webhook HMAC + logs** | Enterprise não confia em webhook sem assinatura. |

### 🟡 MÉDIO — Melhora percepção e retenção

| # | Feature | Justificativa |
|---|---------|---------------|
| 9 | Múltiplos webhooks por form | Limita automações complexas |
| 10 | Zapier/Make nativo | Ecossistema de integrações é argumento de venda |
| 11 | Slack/Discord notificações | Muito pedido em form tools |
| 12 | Coleta de pagamento no form | Cross-sell/upsell dentro do form (Stripe) |
| 13 | GA4 nativo | Complemento natural aos pixels existentes |
| 14 | UTM → pixel attribution | Melhora ROI de ads do próprio cliente |

### 🟢 BAIXO — Nice-to-have

| # | Feature | Justificativa |
|---|---------|---------------|
| 15 | Onboarding interativo | Melhor, mas atual funciona |
| 16 | JSON export | Devs pedem, mas não bulk |
| 17 | Regras de automação condicional | Avançado, Plus+ feature |
| 18 | Mais question types | 15 é suficiente para maioria |

---

## 4. Bugs Prioritários (Impactam Confiança do Comprador)

| Prioridade | Bug | Impacto |
|-----------|-----|---------|
| P1 | Emails duplicados (3 implementações) | Usuário recebe 2x notificação = spam percebido |
| P1 | Multi-user Pro não implementado | Promessa não cumprida = chargeback |
| P2 | Data do ciclo hardcoded | Mostra data errada na billing = confusão |
| P2 | Feature gating client-side | Usuário pode usar features premium sem pagar |
| P2 | UTM session/local storage mesma key | Dados de UTM corrompidos |
| P3 | TikTok page() duplicado | Inflação de métricas |
| P3 | Código morto (pixel-event-engine.ts, integration-stubs.ts) | Dívida técnica |

---

## 5. Sugestão de Roadmap (Maximizar Conversão)

### Sprint 1 — Fundação de Confiança (1-2 semanas)
1. Fixar emails duplicados (P1)
2. Remover código morto (P3, rápido)
3. Fixar data do ciclo (P2)
4. Implementar **embed snippet** (🔴 #1) — impacto máximo com esforço moderado

### Sprint 2 — Checkout & Retenção (1-2 semanas)
5. Adicionar **PIX/Boleto** ao checkout Asaas (🟠 #6)
6. Implementar **exportação Excel** (🟠 #4)
7. Fixar feature gating server-side para features críticas (P2)

### Sprint 3 — Profissionalização (2-3 semanas)
8. **Branding de conta** (logo, favicon, email sender) (🟠 #5)
9. **Webhook HMAC + delivery logs** (🟠 #8)
10. **Meta CAPI** (🟠 #7)

### Sprint 4 — Enterprise (3-4 semanas)
11. **Multi-user real** (🔴 #2) — ou remover da oferta
12. Múltiplos webhooks (🟡 #9)
13. Zapier/Make nativo (🟡 #10)

---

## Arquivos Auditados

- `lib/pixel-event-engine.ts`, `lib/pixel-events.ts`, `lib/utm-tracker.ts`
- `lib/webhook-dispatcher.ts`, `lib/webhook-validator.ts`, `lib/form-integrations.ts`, `lib/integration-stubs.ts`
- `lib/google-sheets.ts`, `lib/whatsapp.ts`, `lib/notify.ts`, `lib/email.ts`, `lib/resend.ts`, `lib/asaas.ts`
- `lib/plans.ts`, `lib/plan-limits.ts`, `lib/billing-profile.ts`, `lib/custom-domain.ts`
- `lib/themes.ts`, `lib/templates.ts`, `lib/questions.ts`
- `components/pixels/`, `components/billing-plans.tsx`, `components/pricing-section.tsx`, `components/onboarding/`
- `app/(dashboard)/billing/`, `app/(public)/page.tsx`, `app/f/[slug]/page.tsx`
- `components/settings/domain-settings.tsx`
