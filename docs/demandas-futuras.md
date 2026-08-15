# Demandas Futuras — EidosForm

> Lista de coisas que **decidimos fazer**, mas que **não são prioridade agora**.
> Diferente de `docs/audits/` (achados de auditoria) e do backlog de correção da auditoria
> 2026-08 (`eidos-shared/auditoria-geral-2026-08/99-sintese/plano-remediacao.md`), que trata de
> defeitos. Aqui entram funcionalidades e melhorias nascidas de decisões conscientes.
>
> **Como usar:** cada item tem ID (`D-nn`), origem, o problema real que resolve, e o que já existe
> no código que pode ser reaproveitado. Item concluído sai daqui e vira registro no CLAUDE.md.

---

## D-01 · ✅ FASE E-MAIL PRONTA — Régua de cobrança para inadimplência

**Construída em 11/08/2026**, com os textos aprovados pelo Sidney na revisão (5 correções dele:
não citar a plataforma de cobrança, incluir link de pagamento, detalhar o prazo e o que se perde,
um e-mail POR DIA, e gatilho de perda concreto a partir do D+3).

**Régua de 6 estágios** (D+0 a D+5), rotação de horário 9h/12h/17h com o **D+4 fixo de manhã** —
é a véspera do corte da meia-noite e o cliente precisa do dia inteiro para resolver com o banco.

**Arquitetura:** `lib/dunning-engine.ts` decide (agnóstico de canal), `lib/dunning-content.ts`
tem os textos dos DOIS canais lado a lado, `app/api/cron/dunning/route.ts` entrega. A decisão
mora no motor, ANTES de qualquer canal — assim é impossível um canal disparar sem as checagens
do outro, que foi a exigência do Sidney. Um cérebro, duas bocas.

**Gatilho de parada:** nada é agendado com antecedência; a cada rodada o estado é relido do banco
e do gateway. Quem pagou no meio da régua não recebe o aviso seguinte — sem ninguém cancelar nada.

**Brinde:** a régua virou o detector de falha do `expire-plans`, que nunca teve alarme próprio
(verificado: zero alertas no arquivo). Passou do prazo e a conta segue paga = o rebaixamento não
aconteceu → alerta operacional no WhatsApp do dono. Ela detecta e avisa; NUNCA rebaixa — dois
sistemas escrevendo no mesmo estado de dinheiro é como nascem os bugs desta auditoria.

**Link de pagamento:** `getLinkPagamentoVencido` traz a página da fatura vencida, onde o cliente
paga com o mesmo cartão ou troca por outro — resolve "trocar cartão" e "lançar pagamento" sem
construirmos tela. (⚠️ Este texto já afirmou "aceita Pix e boleto", sem evidência e contra a
decisão de só-cartão. Corrigido em 15/08.)
Sem link, o botão vira "responda este e-mail": botão quebrado numa cobrança é pior que nenhum.

**55 testes** (23 do motor, 20 dos textos, 12 do cron). Sabotagem provada nas garantias:
cobrar quem pagou, mentir sobre o rebaixamento, D+4 à noite, quebra de paridade entre canais e
idempotência do dia.

⏳ **Falta:** ligar o timer (receita em `docs/D-01-ativacao.md`) e, na 2ª onda, submeter os 6
templates à Meta e ligar `DUNNING_WHATSAPP_ENABLED=true`.

**Origem:** decisão do Sidney em 06/08/2026, durante o lote 1D da auditoria geral.

**O problema.** O cron `expire-plans` agora exige prova de pagamento antes de estender o plano, com
**carência de 5 dias** (`OVERDUE_GRACE_DAYS`). Isso fechou o buraco de acesso pago sem receita —
mas criou uma carência **silenciosa**: o cliente cujo cartão falhou não é avisado de nada. Ele
descobre que caiu para o free quando os formulários dele param, sem nunca ter sido informado de que
havia uma fatura vencida.

Do ponto de vista de negócio isso é pior que o bug original: perde-se a chance de recuperar a
receita (a maioria das falhas de cartão é resolvida com um aviso) **e** queima-se a relação com o
cliente.

**O que construir.** Uma sequência de comunicação disparada pelo estado de inadimplência:

| Momento | Canal | Mensagem |
|---|---|---|
| Fatura vence (D+0) | e-mail | "Não conseguimos processar seu pagamento" + link para atualizar cartão |
| D+2 | WhatsApp | lembrete curto |
| D+4 | e-mail + WhatsApp | "Seu plano será alterado para o gratuito amanhã" — última chance |
| D+5 (rebaixou) | e-mail | o que mudou na prática (formulários pausados, cota) + como reativar |

**O que já existe e pode ser reaproveitado:**
- `lib/resend.ts` e os templates de e-mail em `lib/templates.ts`
- A integração WhatsApp em `services/whatsapp/` (a Elen usa a Cloud API oficial)
- `hasOverduePaymentForSubscription()` em `lib/asaas.ts` — já devolve `oldestDueDate`, que é
  exatamente o gatilho de "há quantos dias está vencido"
- O próprio `expire-plans` já varre os perfis vencidos diariamente

**Cuidados conhecidos:**
- ⚠️ Template de WhatsApp: a Meta recategoriza pelo TEXTO. Cobrança tende a cair em MARKETING
  (~9× mais caro). Ver a ficha `whatsapp-template-categoria-utility` na memória antes de escrever.
- ⚠️ O padrão sistêmico nº 2 da auditoria ("aceite promovido a entrega") vale aqui: não tratar
  `200` do provedor como mensagem entregue.
- Precisa existir uma tela de **atualizar cartão** para o link do e-mail levar a algum lugar — hoje
  ela não existe (ver a "PRÓXIMA FEATURE" no CLAUDE.md, sobre cartão morto).

**Dependência:** faz pouco sentido avisar "atualize seu cartão" sem ter onde atualizar. Idealmente
vem junto ou depois do fallback de cartão morto já planejado.

---

## D-02 · Fechar os buckets de anexos (`form-uploads`, `form-images`)

**Origem:** auditoria geral 2026-08 (S0), adiado conscientemente pelo Sidney no lote 1B.

**O problema.** Os dois buckets estão públicos: quem tem o link abre o arquivo sem autenticação.
Confirmado por download anônimo real durante o Lote 0.

**Por que foi adiado (e a decisão está certa).** A enumeração anônima está bloqueada e os nomes são
UUID — não há como varrer nem adivinhar. O risco exige **URL vazada** (link compartilhado, referer,
planilha do cliente, CRM). E a correção não é trocar um flag: a URL pública é **gravada no banco** na
hora do upload, então fechar o bucket quebra retroativamente todos os anexos já coletados — painel,
exports, Google Sheets, webhooks já entregues.

**Caminho recomendado (opção A do plano):** rota proxy `/api/files/[...path]` que confere o dono e
faz stream do arquivo; bucket privado; migração das URLs já gravadas.

**Não esquecer:** `lib/field-validators.ts:356-363` **exige** o prefixo público — muda junto, senão
todo upload novo é rejeitado.

_Detalhe completo: `plano-remediacao.md` §1B._

---

## D-03 · ✅ FEITO — Rastreamento de migrations (`supabase_migrations`)

**Origem:** achado do Lote 0 da auditoria; cobrou o preço 4 vezes no mesmo dia.
**Fechamento:** 11/08/2026 — o Sidney criou `supabase_migrations.schema_migrations` pelo SQL
Editor (com RLS habilitado + revoke de anon/authenticated) e o `select` de verificação devolveu
tabela vazia, como esperado.

**A regra operacional daqui em diante:** toda mudança de banco pelo SQL Editor leva DUAS
instruções na MESMA execução — a mudança e o `insert` de registro:

```sql
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('AAAAMMDD_nome', 'o que esta mudança faz', array['SQL aplicado;']);
```

**Decidido NÃO fazer backfill:** os arquivos de `supabase/migrations/` divergem do banco real
(REGRA Nº 1) — registrar que rodaram institucionalizaria a mentira. O histórico anterior a
11/08/2026 permanece "desconhecido, consultar o catálogo"; o rastreamento cobre do primeiro
registro em diante.

### Situação anterior (histórico)

Não existia registro de quais migrations rodaram. Isso causou: um achado de auditoria falso,
um `REVOKE` que está no arquivo e não no banco, uma assinatura de função errada, e o achado mais
grave de todos (grants amplos ao `anon`), invisível no código.

_Regra ativa no `CLAUDE.md`, seção "🛑 REGRA Nº 1" — atualizada com a existência da tabela._

---

## D-04 · ✅ FEITO — CI que roda os testes (EidosForm e Elen)

**Origem:** auditoria geral 2026-08 (E13), agravado pelo Lote 0.
**Fechamento:** lote 6, em 09/08/2026. Esta ficha ficou marcada como pendente por engano até
10/08 — achada varrendo a lista a pedido do Sidney ("fechamos do lote zero ao 5 já? tem certeza?").

- **EidosForm:** `.github/workflows/ci.yml` roda `npm test` (`a1ad92c` → `5f5cb56` → `d8f0dad`).
- **Elen** (`agenteseidos/eidos-atendente-wpp`): CI criada do zero, roda `npm test`
  (`6fdb418` → `268a616` → `7e8a85e`). Precisa de Node 22+ — a 20 não expande o glob dos testes.
- Ambas obrigatórias em `push` e `pull request` na `main`.
- O **`FLUSHDB` incondicional** que tornava perigoso ligar a CI da Elen foi neutralizado
  (`070e959`): `test/_redis-guard.js` recusa portas de instâncias reais e usa `redis://127.0.0.1:6399/9`.

**O que a CI da Elen achou no primeiro dia:** 7 dos 147 testes só passavam porque liam o `.env`
**desta VPS**, que é configuração de produção. Passavam na máquina do Sidney e em lugar nenhum mais.

### Situação anterior (histórico)

A CI do EidosForm rodava `lint`, `tsc` e `build` — **não** `npm test`. A Elen não tinha CI nenhuma.
As suítes nunca rodavam automaticamente, então as correções da auditoria estavam entrando sem rede:
um `revert` acidental de qualquer uma delas não seria detectado.

---

## D-05 · ✅ FEITO — Fila de reenvio para e-mail (o "outbox" que ficou de fora do lote 3)

**Fechamento:** 11/08/2026. O que destravou foi a mudança de desenho decidida pelo Sidney: a
fila guarda **REFERÊNCIA** (form_id, response_id, papel do destinatário), **nunca conteúdo** — o
e-mail é remontado do banco a cada tentativa. Isso responde a objeção que adiou a demanda no lote
3 (duplicar dado pessoal em repouso) e ainda compra três garantias de graça, cada uma com teste:
resposta apagada → reenvio pulado (exclusão respeitada sem rotina de expurgo); e-mail de
notificação trocado → reenvio vai para o endereço novo; destinatário desligado → reenvio pulado.

**Janela: 48h** (decisão do Sidney). "Chegou um lead" é informação de hora, não de semana, e o
lead nunca se perde — está no painel. Esgotada a janela, o item vira `dead` e o dono é avisado
**por WhatsApp**, que é o canal que funciona quando o e-mail não funciona. A mensagem leva só
referência, sem dado do lead.

Peças: `supabase/migrations/20260811_email_retry_queue.sql` · `lib/email-retry-queue.ts` ·
`app/api/cron/email-retry/route.ts` · gancho em `app/api/responses/route.ts`. 16 testes;
sabotagem provada nas três garantias — e ela pegou **dois testes cegos meus** antes do commit
(fixtures em que outra guarda satisfazia a asserção) e **um erro de desenho**: os degraus de
espera somavam 44,6h contra uma janela de 48h, então os itens morriam por esgotar tentativas e a
janela virava enfeite.

⏳ **Falta rodar a migration** (SQL Editor, D-03) e **ligar o timer** — receita em
`docs/D-05-ativacao.md`. Enquanto não rodar, tudo é no-op silencioso: o código tolera a ausência
da tabela, igual ao `email_deliveries` do lote 3.

**Origem:** lote 3 da remediação (item L3-4). O plano listava
`lib/resend.ts:145 + lib/notification-email.ts:110 — receber webhook delivered/bounced; **outbox**`.
A primeira metade foi feita e está no ar; **a fila de reenvio não**.

**O que existe hoje.** `sendEmailWithRetry` tenta 3 vezes, com espera de 1s/5s/10s, dentro da mesma
invocação. Se as três falharem, `lib/email-delivery.ts` **não chega a gravar nada** — a linha só
nasce quando há `id` da Resend, isto é, quando houve aceite. O rastro que sobra é o `logError` do
chamador (`app/api/responses/route.ts`, "Lead email rejected").

**O buraco.** Falha do transporte que dure mais que ~16 segundos = notificação perdida em definitivo.
Não há reenvio depois. O caso concreto: Resend fora do ar por alguns minutos, ou cota estourada —
todo lead que chegar nessa janela não gera e-mail para o dono, e nunca vai gerar.

Compare com o WhatsApp, que JÁ tem esse mecanismo: `services/whatsapp/outbox.js`, com `pending`,
`dead`, tentativas espaçadas e alerta. O e-mail não tem equivalente.

**Por que ficou de fora, e não é preguiça.** A análise de risco do lote foi explícita: gravar a
intenção ANTES do envio (estado `pending`) cria estado fantasma — um `pending` órfão, deixado por um
processo morto entre gravar e enviar, é indistinguível de um envio que nunca aconteceu. Uma fila só
fica correta com um processo que a drena e um critério de morte; isso é trabalho de lote próprio, não
de remendo. A decisão registrada foi: **a linha em `email_deliveries` é COMPROVANTE, nunca intenção.**

**Desenho provável quando for feito:**
- tabela própria (`email_outbox`) ou coluna de estado separada — **não** reaproveitar
  `email_deliveries`, que hoje tem um contrato limpo ("existe ⇒ a Resend aceitou");
- gravação só no caminho de falha das 3 tentativas, com o payload completo (assunto + HTML), o que
  levanta questão de PII em repouso — o corpo do e-mail carrega os dados do lead;
- drenagem por cron (há timers systemd na VPS e um cron diário na Vercel — vide `DEPLOY.md`);
- critério de morte + alerta ao dono, reaproveitando o caminho de `webhook_failure_notifications`.

**Precondição:** decidir a retenção do payload com PII antes de escrever qualquer linha.

---

## D-06 · ✅ VALIDADO EM NAVEGADOR — Calendly (10/08/2026)

**Origem:** lote 5 da remediação, commit `1a59957` (07/08/2026).
**Fechamento:** teste manual do Sidney em produção, contra `aa903e1`, em 10/08/2026.

### O que foi validado de verdade

| Cenário | Resultado |
|---|---|
| Calendly como ÚLTIMA pergunta, agendamento real | ✅ avançou sozinho para a tela de obrigado |
| Calendly com uma pergunta DEPOIS dele | ✅ avançou sozinho para a pergunta seguinte |
| Prazo do avanço | ✅ 3 segundos (`AUTO_AVANCO_MS`) |
| Velocidade de abertura da grade | ✅ melhorou com o `preconnect` de `be50114` |

### Segunda rodada, mesmo dia — o embed inteiro e o avanço só pelo Calendly (`c3f706f`)

O print do Sidney no celular mostrou o problema seguinte: a caixa do Calendly tinha altura fixa
(máx. 630px) e rolagem interna, então o botão "Agendar Evento" **dele** nascia fora da área
visível — enquanto o nosso "OK" ficava logo abaixo, grande e colorido.

| Cenário | Resultado |
|---|---|
| Embed ocupa a altura toda, sem rolagem interna (celular e desktop) | ✅ validado |
| Botão "OK" e setinha ▾ somem enquanto não há agendamento | ✅ validado |
| Agendamento real → avanço em 3s | ✅ segue funcionando |

Fechadas **quatro** portas, não uma: botão, setinha ▾ do rodapé, tecla Enter e seta ↓. Pergunta
opcional ganha um "Pular por agora" discreto — sem ele, quem não quisesse agendar ficaria sem saída.

**Defeito pré-existente corrigido junto:** o `widget.js` varre `.calendly-inline-widget` uma única
vez, quando é avaliado (zero `MutationObserver` no arquivo). Como o script só era injetado se
ainda não estivesse na página, a SEGUNDA montagem do componente não disparava varredura nenhuma —
quem voltava para a pergunta do Calendly encontrava a caixa **vazia**. Provado em Chromium
headless com o widget.js real: código antigo → vazio nas montagens 1 e 2; código novo → iframe nas
montagens 1, 2 e 3. Agora a inicialização é explícita (`initInlineWidget` com `resize` e
`inlineStyles`) e `data-auto-load="false"` desliga a varredura.

⚠️ A altura tem de ser `height`, **nunca** `min-height`: o mesmo experimento confirmou que o
iframe nasce com `height="100%"`, e porcentagem contra pai de altura indefinida vira `auto` — a
caixa colapsaria para ~150px.

**Primeira cobertura automática que esta pergunta já teve:** a regra virou `getAdvanceControls` em
`lib/form-logic-engine.ts`, com 9 testes. As duas sabotagens (trava que não liga; trava que vaza
para os outros 19 tipos) foram provadas pegas.

**Decidido NÃO fazer:** contingência para o embed não carregar (bloqueador/firewall). Risco nunca
medido, e o Calendly não entra nas listas padrão de bloqueio. Se um dia o sintoma aparecer,
instrumentar antes de construir.

### O que NÃO foi coberto pelo navegador (verificado só por leitura de código)

- pergunta do tipo Calendly **não obrigatória**, e o botão "Pular por agora";
- ir e voltar entre perguntas **antes** de agendar — o remount foi provado em Chromium com o
  widget.js real, mas não dentro do app React;
- voltar à pergunta do Calendly **depois** de agendar. Pela leitura: mostra o cartão de confirmado
  (`question-renderer.tsx`, ramo `if (value)`), a resposta em objeto passa na regra de obrigatório
  (`form-player.tsx:259-268`), e o botão normal segue em frente. **Não há como reagendar** — é
  comportamento de produto, nunca decidido, não defeito.

### O que esta demanda ensinou (custou 2 testes manuais do Sidney)

1. **O avanço automático foi quebrado DUAS vezes por refatoração**, e nas duas o único detector foi
   o teste manual. Segue sem teste de componente React no repositório — a suíte de 1.166 testes não
   toca nada disso. Enquanto for assim, **toda mexida em `CalendlyQuestion` exige teste manual**.
2. **O deploy da Vercel pode simplesmente não acontecer.** O commit `be50114` teve CI verde e a
   Vercel nunca criou o build; o Sidney testou o código antigo duas vezes e reportou defeito que já
   estava corrigido. Conferir `GET /api/health` (devolve o commit servido) **antes** de pedir teste.

### Situação anterior (histórico)

A correção estava NO AR e **nunca havia sido validada em navegador**. Não existe um único teste de
componente React neste repositório — a suíte verde não cobre nada disso. Foi ao ar porque a
funcionalidade estava 100% quebrada e ZERO clientes a usam (as perguntas do tipo `calendly` em
produção são testes do Sidney).

**Por que tem prazo.** "Agendamento com Calendly" está na vitrine de planos
(`lib/plan-marketing.ts:83`), vendido a partir do Starter. O dia em que o primeiro cliente ligar o
recurso é o prazo final. Não é urgente hoje; é bloqueante para abrir vendas.

**O que estava quebrado.** `scriptLoadedRef` guardava o OUVINTE de mensagens do Calendly além do
script. Na primeira execução o ouvinte era registrado; em qualquer re-render (`onChange`/`onSubmit`
são recriados a cada render do pai) o React removia o ouvinte e o efeito saía na primeira linha —
o ouvinte nunca voltava. A pessoa agendava de verdade na agenda do cliente e o EidosForm não
registrava nada; com a pergunta obrigatória, virava beco sem saída, e recarregar não resolvia.

### Roteiro de validação (precisa de conta Calendly + conta Starter ou superior)

1. Criar branch a partir da `main` e abrir o **preview da Vercel** desse branch.
   ⚠️ **NÃO validar em `npm run dev`** — o StrictMode do React monta o componente duas vezes e
   mascara exatamente esta classe de defeito. **NÃO validar direto na `main`** — aqui deploy é
   `git push main`, então "testar em produção" significa já ter publicado.
2. Criar formulário com uma pergunta do tipo Calendly, com URL real preenchida, **obrigatória**.
3. Abrir o formulário publicado e agendar de verdade.
4. **Critério de aceite:** aparece o cartão verde de confirmação, o formulário **avança sozinho**
   em ~1s, e a resposta gravada contém `event_uri`.
5. Repetir com a pergunta **não** obrigatória, e repetir voltando/avançando entre perguntas antes
   de agendar (é o re-render que causava o defeito).

**Se falhar:** a suspeita seguinte, ainda NÃO confirmada, é `Calendly.initInlineWidget` não ser
rechamado no remount (a caixa do Calendly apareceria em branco). Não escrever código contra essa
hipótese antes de ver o sintoma — este projeto já teve uma reversão por isso.

---

## D-07 · ✅ FEITO — Fechamento id-a-id do registro-geral + triagem dos suspensos

**Origem:** varredura de 11/08/2026 ("fechamos do lote zero ao 5? tem certeza?").

**O problema que já foi resolvido pela metade.** O `registro-geral.csv` (881 linhas) ficou 100%
ABERTO durante a remediação inteira — nenhum artefato respondia "o que já fechou", e foi assim que
documentos de lote disseram "concluído" sem lastro. A reconciliação de 11/08
(`auditoria-geral-2026-08/scripts/reconciliar-registro.py`, regras conservadoras) baixou o que
tinha decisão documentada: **670 → DIVIDA-ASSUMIDA** (plano §7), **15 → REFUTADO-TRIAGEM**.

**O que resta.** (a) **79 ids S0/S1 ainda ABERTOS** — a maioria FOI corrigida pelos lotes 1-6,
mas sob outros nomes (1A, L2-3, D8, "achado 2 da Elen"); a ponte id-do-CSV ↔ item-de-lote precisa
ser feita id-a-id, com evidência, nunca em massa. Lista pronta em
`achados/RECONCILIACAO-2026-08-11.md`. (b) Os **"achados em suspenso"** dos 4 lotes auditados via
chat (E06-L3, E06-L4, E09-L1, E11-L1 — 682 KB em `99-sintese/pendencias-gpt/`), que o plano §7
mandava reavaliar "em ~1 semana" (06/08) e ninguém reabriu. Inclui os 3 REFUTADOS **por
indisponibilidade de evidência** do E11, que o 1º auditor sustenta — um deles toca consentimento
de envio.

**EXECUTADO em 11/08/2026 — e "sem código" estava errado: a triagem achou 5 defeitos REAIS.**

Ponte id-a-id: os 79 ids conferidos um a um contra o código (mapa curado em
`auditoria-geral-2026-08/scripts/ponte-id-a-id.py`; baixa só com evidência). Placar final:
115 FECHADO · 19 REFUTADO · 16 DECISAO-REGISTRADA · 702 DIVIDA-ASSUMIDA · **29 linhas (12 ids)
ABERTOS de verdade**, cada um com nota do que falta (`achados/RECONCILIACAO-2026-08-11.md`).

Suspensos: os 4 lotes sem contraditório foram triados — nenhum S0/S1 restou sem destino.
Os 5 defeitos reais achados e corrigidos no ato: consentimento não reconferido no disparo
(elen b14fd7c) · XSS por href em aspas simples (f3cc98f) · API key crua no rate limit (f3cc98f) ·
dropdown/checkbox de 1 opção = 422 permanente (0df8500) · rating min≥max inenviável (0df8500).

## D-08 · Meta CAPI por cliente (pixel global aposentado)

**Origem:** §0.8 do lote 0 — o ÚNICO dos 8 achados da investigação que nunca entrou em lote nem
em demanda (varredura 11/08/2026).

**O problema.** `lib/meta-capi.ts` usa `META_PIXEL_ID`/token GLOBAIS da plataforma e
`event_name: 'Lead'` fixo. Os pixels dos clientes são POR FORMULÁRIO: o CAPI server-side hoje
mistura eventos de todos os clientes num pixel só, sem dedup real com o browser. Por isso o CAPI
está **fora da vitrine** ("NÃO ANUNCIAR", auditoria LP 2026-07-28).

**O que é.** Funcionalidade, não conserto: config de pixel+token CAPI por cliente/formulário,
`event_id` real para dedup, e só então anunciar. Pré-requisito para vender CAPI como recurso.

**Esforço:** 1-2 sessões. Bloqueia apenas o ANÚNCIO do recurso, não as vendas.
