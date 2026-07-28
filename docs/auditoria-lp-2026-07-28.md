# Auditoria LP × Código — 2026-07-28

> Auditoria completa do cruzamento entre as landing pages (/, /v2, /v3, /v4)
> e o código real do produto, seguida da execução das Fases 1–4 do plano de
> correção. Este documento é o registro do que foi encontrado, o que foi
> corrigido (com commits) e o que ficou pendente.

## Contexto

- **/v3 e /v4 são a MESMA página** (conteúdo idêntico, tema escuro/claro),
  ambas `noindex`, em teste A/B. A página indexada é a **raiz** (`app/page.tsx`).
- A lista de planos estava **hardcoded em 6 lugares** e divergia entre eles —
  essa era a causa-raiz da desatualização.

## O que a auditoria encontrou

### Bloco 1 — Existia no produto, faltava na página
1. WhatsApp: notificação detalhada de novo lead, **alerta de lead abandonado**,
   link wa.me de resposta (a página dedicava 1 linha a tudo).
2. Eventos por **conjunto de respostas** (`evaluateAnswerSetEvents`, modos
   "todas"/"pelo menos N").
3. **Meta CAPI server-side** com Advanced Matching (bloqueada por comentário
   desatualizado "não anunciar" no topo da /v3).
4. **Campos ocultos por URL** (mesma nota desatualizada).
5. 20 tipos de pergunta, 11 templates (2 de agência), Mapa da Lógica,
   exportação Excel (Starter+) e PDF (Plus+), pastas, UTM no Google Sheets.

### Bloco 2 — Estava na página, não existia (ou não chegava ao cliente)
1. "Alerta de limite (80%)" — função **morta** (`checkResponseLimit` nunca era
   chamada).
2. "Taxa de abandono por pergunta" — endpoint completo e gated
   (`/api/forms/[id]/analytics`) mas **sem nenhuma tela** consumindo.
3. "Tempo médio de resposta" + "dashboards detalhados" (raiz) — mesmo caso.
4. "Exportação CSV avançada" (Professional) — mesmo CSV do Starter, sem lastro.
5. Depoimentos placeholder com nomes reais.

### Bloco 3 — Estava na página, errado
1. Google Sheets omitido do Starter (o código libera no Starter).
2. Marca d'água omitida do Free/Starter na v3/v4.
3. "Suporte por email" no Free (canal real é WhatsApp).
4. FAQ dos 80% prometia gate Plus+ que não existia.

### Bloco 4 — Vazamentos de código
1. 🔴 `redirect_url` sem NENHUMA trava (vendido no Starter, funcionava no Free).
2. 🟡 Sheets de parciais não revalidava plano pós-downgrade.
3. 🟡 4 dos 5 crons não agendados no `vercel.json` (incluindo os reconciles de
   billing e o abandoned-leads).
4. 🟡 Gate de API comparava `!== 'professional'` em vez de ler `apiAccess` (D8).
5. 🟡 `/register` sem `?cycle` → default `annual` → 400 no checkout.
6. 🟡 UTM não chegava ao webhook nem ao WhatsApp.

## Decisões (Sidney, 2026-07-28)

| # | Decisão | Resultado |
|---|---|---|
| 0.1 | Página raiz | **Adiado** — aguarda vencedor do A/B v3×v4 |
| 0.2 | Alerta 80% | Religar **só Plus+** (como vendido) |
| 0.3 | "CSV avançada" | **Remover** a promessa |
| 0.4 | Depoimentos | **Manter como estão** (risco apontado; decisão do Sidney) |
| 0.5 | Redirect | Travar edição Starter+; player ignora redirect de dono Free |

## O que foi executado (Fases 1–4)

### Fase 1 — Vazamentos (`9e6c258`)
- `redirect_url` Starter+ em 3 camadas: API (403 no PUT, strip no POST),
  player público (`app/f/[slug]`), builder (campo travado + upsell).
- Sheets parcial revalida plano do dono no envio (+ teste de regressão).
- Alerta de 80% religado: `checkResponseLimit` (morta) → `sendNearLimitAlert`,
  chamada nos 2 caminhos de submissão; dedupe segue na RPC
  (`limit_alert_sent`); gate Plus+.
- Gate de API lê `PLANS[].apiAccess`.
- `?cycle` default `yearly` (com normalização de `annual` legado).
- 4 crons agendados: reconcile-checkouts `*/10`, reconcile-subscriptions
  `5,35`, sweep-received `12,42`, abandoned-leads `*/15`.

### Fase 2 — Fonte única (`57c9139`, −492 linhas duplicadas)
- **`lib/plan-marketing.ts`**: vitrine única; preços/cotas derivados de
  `PLANS`. Correções do Bloco 3 aplicadas na fonte.
- **`lib/plan-marketing.test.ts`**: 23 asserts vitrine×runtime — promessa sem
  flag quebra o CI.
- 5 componentes (raiz, v2, v3, v4, billing) só guardam apresentação.
- `plan-definitions` perdeu o campo `features` (órfão de runtime).

### Fase 3 — Última milha (`397c4ea`)
- **`components/responses/analytics-panel.tsx`**: abandono por pergunta em
  barras CSS + tempo médio, na página de respostas; upsell Plus+ para
  free/starter; endpoint ganhou `plan_gated`.
- UTM no payload do webhook (campo aditivo `utm`).
- `{utm_*}` no template do WhatsApp (novo lead e alerta de abandono) +
  grupo "Campanha (UTM)" documentado no painel.

### Fase 4 — Copy v3/v4 (`a25d900`)
- Nota "não anunciar" removida; bloco de tráfego 4→6 cards (CAPI server-side,
  campos ocultos); seção própria de WhatsApp com mockup CSS; Mapa da Lógica,
  20 tipos/11 templates; agência com templates + UTM no CRM; FAQ atualizado
  (+2 perguntas); metadata das duas páginas.

## Pendências

1. **Fase 5 — promover à raiz**: aguarda decisão do A/B (0.1). Ao promover:
   mover conteúdo pra `app/page.tsx`, remover `noindex`, redirect 308 da
   perdedora e da /v2, atualizar OG.
2. **Verificar plano da Vercel**: crons sub-diários exigem **Vercel Pro**
   (Hobby = diário). Se Hobby, rebaixar cadências ou migrar pra outro agendador.
3. **Confirmar na VPS** que `abandoned-leads` não roda por timer lá (no repo
   só há timer de healthcheck) — evitar disparo duplo.
4. Depoimentos: seguem placeholder por decisão 0.4 — recomendo trocar por
   reais com autorização assim que existirem.
5. 3 testes de `services/whatsapp` falham na base (dependem de ambiente da
   VPS) — pré-existentes, não relacionados a estas fases.
6. `ADMIN_ALERT_EMAIL` na Vercel (pendência antiga do CLAUDE.md, segue de pé).

## Invariantes novos (para não regredir)

- **Toda vitrine importa de `lib/plan-marketing.ts`.** Nunca redigitar lista
  de plano em componente.
- **Todo bullet gated precisa de flag em `PLANS`** — o
  `plan-marketing.test.ts` é o guarda.
- Feature nova anunciável ⇒ atualizar a fonte única, não as páginas.
