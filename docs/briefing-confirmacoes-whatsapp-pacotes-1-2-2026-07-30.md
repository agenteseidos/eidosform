# Briefing para parecer (Codex) — Confirmações WhatsApp: botões + ficha da conta na Elen

**Data:** 2026-07-30 (noite)
**Solicitante:** Sidney
**Autor:** Claude (Claude Code na VPS)
**Estado do repo:** `main` = `449c604` (+ commits Zeca posteriores), produção sã, 753 testes verdes
**Natureza:** os PACOTES 1 e 2 abaixo estão desenhados e aprovados pelo Sidney, **NADA deles
implementado**. Codex: critique o desenho, aponte riscos, ajuste — a implementação sai depois
do teu parecer.

---

## 1. O que o Sidney quer (visão de produto)

1. Cliente que **age na própria conta** (cadastra, compra, muda de plano, cancela, ganha
   cortesia) recebe **confirmação por WhatsApp** — além dos e-mails que já existiam. Não é
   notificação pro admin; é confirmação pro cliente.
2. Essas mensagens levam **botão** de volta pro produto (login / gerenciar assinatura).
3. Quando o cliente **fala com a Elen** (o agente de WhatsApp do produto), ela deve
   **reconhecê-lo**: chamar pelo nome do cadastro e saber o estado da conta (qual plano, se
   cancelou, até quando vai o acesso) — com uma regra explícita do Sidney para **contas
   institucionais**: cadastro em nome de empresa ("Agência Grilo") NUNCA vira vocativo; a Elen
   pergunta com quem fala e memoriza o responsável.

## 2. O que JÁ está no ar (fase 0, entregue em 30/07 — commit `449c604`)

Para você não redesenhar o que existe:

- **`lib/whatsapp-confirmations.ts`** — envio de template via Cloud API oficial (envs
  `WHATSAPP_CLOUD_TOKEN`/`WHATSAPP_CLOUD_PHONE_ID`, criadas na Vercel via API). Fire-and-forget
  SEMPRE (ação principal nunca falha por mensagem); busca perfil fresco; sem telefone → pula
  (OAuth Google fica no e-mail); opt-out plugável (`ELEN_OPTOUT_CHECK_URL`, fail-open por ser
  transacional); template PENDING → logError e segue.
- **Ganchos** espelhando os e-mails existentes (herdam a idempotência deles):
  `plano_ativado` = webhook dentro do `claimActivationEffects` + reprocess ·
  `assinatura_cancelada` = 3 pontos do webhook + reprocess ·
  `plano_alterado` = `executePlanSwitch` (reativação de MESMO plano+ciclo não notifica) ·
  `cadastro_confirmado` = `auth/callback` `type=signup`, dedupe por flag
  `wpp_cadastro_notified` em `user_metadata` gravada SÓ após envio ok, rodando em `after()`.
- **Admin**: checkbox "Avisar o cliente" (default ON) no dialog de plano; mapeamento
  grant→`plano_alterado` com "nenhuma — cortesia válida até X", →free→`cancelada` com "hoje",
  ajuste de data→`acesso_atualizado`; resultado (`customer_notified`/`notify_skipped`) gravado
  no journal `admin_actions`.
- **5 templates UTILITY submetidos à Meta**, todos PENDING (aguardando ~24h):
  `eidosform_cadastro_confirmado` (2ª versão — a 1ª flipou p/ MARKETING por "este é o nosso
  canal oficial", foi deletada; nome antigo bloqueado ~30d) · `eidosform_plano_ativado` ·
  `eidosform_plano_alterado` · `eidosform_assinatura_cancelada` · `eidosform_acesso_atualizado`.
- **Tubulação testada em produção**: template já-aprovado (`eidosform_cadastro_v2`, da
  campanha) entregue no número do Sidney via Graph API (wamid confirmado).

## 3. PACOTE 1 — Botões de URL nos templates (aprovado, textos validados)

### 3.1 O que muda nos templates
Template não é editável → **apagar os 5 PENDING e ressubmeter** com componente BUTTONS
(tipo URL), nomes novos com sufixo `_v2` (nome apagado fica bloqueado ~30d):

| Template | Corpo | Botão |
|---|---|---|
| cadastro_confirmado_v2 | igual ao aprovado | `Acessar minha conta` → `https://eidosform.com.br/login` |
| plano_ativado_v2 | igual | idem |
| plano_alterado_v2 | igual | idem |
| acesso_atualizado_v2 | igual | idem |
| assinatura_cancelada_v2 | **muda o fim**: "…Se mudar de ideia, dá para reativar quando quiser." (o link `/billing` sai do corpo — virou o botão) | `Gerenciar assinatura` → `https://eidosform.com.br/billing` |

No código: só trocar as strings em `CONFIRMATION_TEMPLATES`. Janela conhecida: entre o deploy
e a aprovação dos `_v2`, envios falham com logError (comportamento já projetado — destrava
sozinho). Botão de URL **não** interage com o bot (só abre navegador); resposta DIGITADA cai na
Elen, e os corpos convidam a isso de propósito.

### 3.2 Pré-requisito: consertar o P1-8 (login perde o destino)
Catalogado na auditoria de 29/07 e agora URGENTE por causa do botão da cancelada: quem clica
`/billing` deslogado → middleware manda pro login com `?redirect=/billing`
(`lib/supabase/middleware.ts:88`) → **ninguém lê esse parâmetro**: a tela de login só lê
`message`/`error`, e `app/api/auth/login/route.ts:64` devolve `redirectTo: '/forms'` fixo. Há
ainda inconsistência de nomes (`redirect` no middleware × `next` no resto do fluxo).
**Proposta:** unificar no param `next`, tela de login lê e repassa ao POST, API valida com o
`safeLocalRedirect` existente (anti open-redirect) e devolve o destino; middleware passa a
gravar `next`. Cobre também o caso original da auditoria (anúncio → `/billing?plan=X` →
login → perdia a intenção de compra).

## 4. PACOTE 2 — Ficha da conta no cérebro da Elen (aprovado, desenho fechado)

### 4.1 Estado atual (verificado no código)
A Elen consulta `POST /api/internal/conversion/check` (Bearer `INTERNAL_API_SECRET`,
timingSafeEqual, rate-limit por HMAC do telefone 6/15min + global 300/15min) e recebe **só um
estado grosseiro**: `paid | free | none | unknown` (`lib/conversion-check.ts`). A grosseria é
**PROPOSITAL para campanha**: inadimplência/chargeback/cancelamento consumado viram `unknown`
= não abordar (comentário no código, decisão de segurança). `avaliarProfile` também exige
`email_confirmed_at` (proteção contra cadastro-fantasma plantado — o P1-3 da auditoria).

### 4.2 O que será implementado
**(a) Lado EidosForm** — a resposta do `conversion/check` ganha, ALÉM do estado atual
(intocado), um bloco novo `ficha`, presente SÓ quando `profiles.length === 1` e
`email_confirmed_at` preenchido:
```json
{ "estado": "paid",
  "ficha": { "nome": "Sidney Crystian", "plano": "plus", "ciclo": "YEARLY",
             "status": "canceling", "acesso_ate": "2026-08-29" } }
```
Sem e-mail, sem CPF, sem dados de cartão, sem ids Asaas. Match múltiplo → sem ficha (como o
estado já faz). A semântica de `decidirEstadoConta` **não muda uma vírgula** (réguas de
follow-up dependem dela).

**(b) Lado Elen (VPS, repo `eidos-atendente-wpp`)** — no fluxo INBOUND: injetar a ficha no
contexto do cérebro (claude-cli) com instrução: *"cadastro em nome de {nome}; se parecer nome
de PESSOA, chame pelo primeiro nome; se parecer EMPRESA/instituição, NÃO use como vocativo —
pergunte com quem fala e memorize"*. Julgamento pessoa×empresa é do MODELO (sem heurística de
código). Nome do responsável informado na conversa → memória por contato que a Elen já tem
(Redis). Instrução adicional: USA o contexto, não recita a ficha; nunca despeja dados de
cobrança espontaneamente.

⚠️ **Sensibilidade operacional:** produção da Elen roda `lab/bot-cloud.mjs` (113 testes,
PM2 `elen-prod-bot`). Mudança ali é fora do repo eidosform, com deploy próprio (PM2 restart) e
histórico de incidentes de sessão. Proposta: mudança mínima, atrás de env flag
(`ELEN_FICHA_CONTA=1`), testável com o número do Sidney antes de ligar geral.

## 5. Ordem de execução proposta

1. **P1-8** (login honra `next`) — independente, destrava o botão da cancelada; testes novos.
2. **Ressubmeter os 5 `_v2` com botão** + trocar `CONFIRMATION_TEMPLATES` + deploy. Auditar
   `previous_category` minutos depois (lição do flip) e de novo pós-aprovação.
3. **Ficha lado EidosForm** (endpoint + testes: match único, sem e-mail confirmado → sem
   ficha, múltiplo → sem ficha, campos exatos).
4. **Ficha lado Elen** (flag OFF → teste com número do Sidney → ligar).
5. Smoke conjunto quando a Meta aprovar: cadastro/compra de teste do Sidney já valida
   mensagens+botões de ponta a ponta.

## 6. Perguntas adversariais para o Codex

1. **Botão de URL × classificador da Meta:** vês risco de os `_v2` fliparem por causa do
   botão? "Acessar minha conta"/"Gerenciar assinatura" me parecem transacionais, mas o
   classificador já nos surpreendeu uma vez. Mudarias algum rótulo?
2. **P1-8:** a unificação em `next` + `safeLocalRedirect` fecha open-redirect? Algum caminho
   (OAuth callback, magic link, `?redirect=` legado em favoritos) que eu quebre ao renomear?
3. **Ficha no `conversion/check`:** concordas em ENRIQUECER o endpoint existente (mesma auth,
   mesmo rate-limit) em vez de criar um segundo? O rate-limit atual (6/15min por telefone) é
   suficiente agora que a resposta carrega PII (nome)? O secret é compartilhado com outras
   rotas internas — isolarias?
4. **Elen/VPS:** a abordagem flag-OFF-primeiro te parece suficiente para não arriscar a
   produção do bot? Alguma armadilha no ciclo de vida da memória por contato (Redis) para o
   "nome do responsável" (TTL? colisão com o caderninho existente?)?
5. **Janela de templates:** entre deploy do código `_v2` e aprovação da Meta, envios falham
   com logError (silêncio pro cliente). Aceitável, ou preferirias fallback temporário para os
   nomes v1 até o `_v2` aprovar (código com os DOIS nomes e tenta na ordem)?
6. **O que eu não vi:** procura especialmente corrida entre o dedupe do cadastro
   (`user_metadata` flag) e o novo botão (a pessoa clica no link de confirmação 2× rápido), e
   qualquer interação da ficha com o P1-3 (cadastro-fantasma) que a exigência de
   `email_confirmed_at` não cubra.

## 7. O que NÃO fazer

- NÃO tocar na semântica de `decidirEstadoConta`/campanha (réguas dependem).
- NÃO usar botão de resposta rápida (acordaria o bot — Sidney quer clique silencioso).
- NÃO expor e-mail/CPF/ids Asaas na ficha.
- NÃO mexer no fluxo de opt-out da campanha.
- NÃO fazer deploy na Elen sem flag e sem teste com o número do Sidney.
- Templates: qualquer texto novo segue o vocabulário UTILITY (ficha
  `whatsapp-template-categoria-utility` no vault) — e auditoria de categoria pós-submissão é
  OBRIGATÓRIA (já flipou uma vez em silêncio).
