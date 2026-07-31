# BRIEFING — Enriquecer as notificações por E-MAIL do EidosForm

**Data:** 2026-07-30
**Autor:** Claude (sessão Opus) a pedido do Sidney
**Destinatário:** Codex
**Base de código:** `main` = `2c814ec` (deploy de produção READY, 788 testes verdes)

---

## 0. O QUE EU QUERO DE VOCÊ

**Análise crítica. NÃO implemente nada.** Não edite arquivos, não abra branch, não
commite. O que eu quero é o seu parecer sobre o plano da seção 4, com foco nos
riscos da seção 5 e nas perguntas da seção 6.

Se discordar do desenho, diga onde e por quê — com evidência do código, não por
preferência de estilo. Se encontrar armadilha que eu não listei, ela é mais
valiosa que a concordância.

---

## 1. CONTEXTO — por que isso virou prioridade agora

Em 2026-07-30 a notificação de lead **por WhatsApp foi removida do produto** e
restringida a uma allowlist de UUIDs (hoje: só a conta do Sidney). Motivo: o
transporte não-oficial levou a linha a uma **restrição de conta de 6 horas** pelo
WhatsApp, com 3 revogações de dispositivos vinculados antes disso. A causa raiz
foi divergência de versão da biblioteca `whatsmeow` no binário do WuzAPI.

O gate está no ar e validado em produção:
- política única em `lib/whatsapp-capability.ts` (`canUseLeadWhatsApp(ownerUserId)`)
- aplicada no sink (`app/api/whatsapp/send/route.ts`), no disparador
  (`app/api/responses/route.ts`) e no cron (`app/api/cron/abandoned-leads/route.ts`)
- `PLANS.*.whatsappNotifications = false` em todos os planos
- vitrine limpa; teste `lib/plan-marketing.test.ts` derruba o build se algum plano
  voltar a prometer notificação por WhatsApp

**Consequência que motiva este briefing:** com o WhatsApp fora, **o e-mail passou a
ser o único canal de notificação que o cliente pagante tem**. E o e-mail atual é
praticamente vazio.

---

## 2. ESTADO ATUAL — com evidência

### 2.1 O e-mail hoje: DUAS implementações divergentes

Existem dois construtores de e-mail de "nova resposta", ambos disparados de
`app/api/responses/route.ts`:

| | `lib/resend.ts` → `sendNewResponseNotification` | `lib/notify.ts` → `sendEmailNotification` |
|---|---|---|
| destinatário | dono da conta (`ownerProfile.email`) | e-mail configurado no form (`form.notify_email`) |
| chamada | `app/api/responses/route.ts:556` | `app/api/responses/route.ts:587` |
| idempotência | **sim** — `sha256(new-response:formId:responseId)` | **não** |
| retry | **sim** — `sendEmailWithRetry` | **não** — `fetch` cru |
| cor/identidade | `#6366f1` (indigo) | `#1E3A5F` + `#F5B731` (azul/amarelo) |
| conteúdo | título do form + botão | título do form + contagem de campos + botão |

Conteúdo do primeiro, na íntegra (`lib/resend.ts:141-152`):

```
Nova resposta recebida! 🎉
Seu formulário <TÍTULO> recebeu uma nova resposta.
[Ver resposta]
```

Não há nome, e-mail, telefone, respostas, horário, origem nem eventos. O
destinatário precisa abrir o navegador e logar para saber se o lead vale algo.

Assunto de ambos: `Nova resposta em "<título>"` — idêntico para todo lead, o que
torna a triagem na caixa de entrada impossível.

Nenhum dos dois usa `reply_to` nem envia parte em texto puro (`text`).

### 2.2 O WhatsApp hoje: o padrão a ser copiado

`lib/whatsapp-template.ts:11-19`:

```
🔔 *Novo lead* em {form_name}

{respostas}

💬 Responder: {whatsapp_link}
🕒 Recebido {data} às {horario}
*Eventos Meta:* {meta_events}
```

E o template de abandono (`lib/whatsapp-template.ts:26-34`):

```
⚠️ *Lead incompleto* em {form_name}
Sem atividade há {abandono_minutos} min — não finalizou.

{respostas}

💬 Responder: {whatsapp_link}
*Eventos Meta:* {meta_events}
```

`buildMessage` (`lib/whatsapp-template.ts:106`) já resolve, em **passagem única**
(anti-injeção), com dois comportamentos importantes:
- **self-hide**: `{whatsapp_link}` e `{meta_events}` apagam a LINHA inteira quando
  não há valor (`dropLineWith`, linha 87)
- **saneamento**: `\p{Cf}` (invisíveis) removidos, `\p{Cc}` (controle) viram
  espaço; multi-linha preserva `\n` (linhas 64-84)

### 2.3 `buildLeadData` — o montador que JÁ EXISTE e deve ser reaproveitado

`lib/integration-stubs.ts:34` monta o pacote consumido pelo `buildMessage`:

- `name`, `nome`, `primeiro_nome`, `nome_completo`, `email`, `phone`/`telefone`
- `form_name`, `response_id`, `response_link`
- `data`, `horario`, `dia_semana`
- `respostas` — bloco com TODAS as perguntas respondidas, na ordem do formulário
  (linha 62)
- `meta_events` — eventos do Pixel/CAPI já registrados (linha 176)
- `utm_source` / `utm_medium` / `utm_campaign` / `utm_term` / `utm_content`
  (linhas 179-183), string vazia quando ausente

**Este é o ponto central do plano:** o e-mail deve consumir a saída de
`buildLeadData`, não montar um segundo pipeline de conteúdo.

Precedente na casa: já tivemos **6 cópias divergentes** da lista de planos
(auditoria 2026-07-28) e o template padrão de WhatsApp **triplicado** (auditoria
2026-07-23). Ambos viraram fonte única. Repetir o erro aqui seria conhecido.

### 2.4 O alerta de abandono é 100% moldado em WhatsApp

`app/api/cron/abandoned-leads/route.ts`:

- **Seleção** parte de `form_whatsapp_settings` com `enabled = true`
  (linhas 241-243). Formulário sem WhatsApp configurado **nunca é considerado**.
- Depois filtra por capacidade **antes do claim** (linha 267):
  `(forms ?? []).filter(f => canUseLeadWhatsApp(f.user_id))`
- **Claim atômico** = INSERT em `form_whatsapp_logs` com
  `status: 'abandoned_alert'` (linhas 394-402); conflito `23505` de índice único
  significa "outra instância ganhou a corrida" — não é falha.
- Colunas do claim: `form_id`, `response_id`, `phone_number`, `message_sent`,
  `status`, `wacli_message_id`, `error_message` — todas WhatsApp-específicas.
- Lease/retomada em linhas 381-386; conclusão em 506-516.
- **Não existe nenhum envio de e-mail neste cron.** Confirmado por grep.

Agendamento: timer systemd `eidosform-abandoned.timer`, a cada 15 min (a conta
Vercel é Hobby: máx. 2 crons, só diários — ver `DEPLOY.md`).

### 2.5 Gates de plano

`lib/plan-definitions.ts` — `emailNotifications`: Free `false` (linha 59),
Starter `false` (81), Plus `true` (104), Professional `true` (126).

Vitrine (`lib/plan-marketing.ts:107`): `'Notificação por email'` aparece **só no
Plus**; Starter e Free não prometem notificação. Ou seja, a vitrine já é honesta
quanto a isso — não há promessa falsa a corrigir.

---

## 3. DECISÕES JÁ TOMADAS PELO SIDNEY — não reabrir

Estas foram decididas hoje, com as contrapartidas expostas. Aponte consequência
técnica se houver, mas não proponha reverter:

1. **Padronizar os dois e-mails** numa estrutura única.
2. **Criar o alerta de lead abandonado por e-mail.**
3. **NÃO usar `reply_to`.** Manter o link `wa.me`, porque quem lê no celular
   toca e abre o WhatsApp direto.
4. **Assunto rico** (aprovado).
5. **Eventos de conversão:** reportar apenas o que o servidor de fato registrou.
   Nada de afirmar entrega confirmada ao Meta. Os pixels de Google/GTM/TikTok
   disparam no navegador do lead e o servidor não sabe o resultado.
6. **Respostas completas vão no corpo do e-mail**, como já vão no WhatsApp.
   Levantei que a base de clientes é de psicólogos e que isso tira dado sensível
   do painel e o coloca em caixas de entrada; o Sidney decidiu prosseguir.
7. **Ambas as notificações permanecem Plus+.** Starter (R$49) e Free seguem sem
   notificação nenhuma. Levantei que o Starter fica sem aviso algum; foi decisão
   consciente, com o alerta de abandono passando a ser o argumento de upgrade que
   a vitrine perdeu quando o WhatsApp saiu.

---

## 4. PLANO PROPOSTO

### Fase 1 — Fonte única de conteúdo

Criar um módulo (nome sugerido: `lib/notification-content.ts`) que recebe a saída
de `buildLeadData` e devolve `{ subject, html, text }`. Consumido pelos dois
canais, de modo que mudança de conteúdo aconteça num lugar só.

Fundir `sendNewResponseNotification` e `sendEmailNotification` numa função única,
**preservando a idempotência e o retry** que hoje só existem em `lib/resend.ts`.
`lib/notify.ts` deixa de existir (ou vira wrapper fino de compatibilidade).

Ponto de atenção: os dois destinatários hoje são deduplicados por
`form.notify_email !== ownerProfile?.email` (`app/api/responses/route.ts:583`).
A fusão precisa preservar esse comportamento e a idempotência **por
destinatário** — a chave atual é `new-response:formId:responseId`, sem o e-mail.

### Fase 2 — Conteúdo rico

- **Assunto:** `Novo lead: {nome} — {form_name}`, com alternativa quando o
  formulário não coleta nome. Sanitizar via `sanitizeSubject` (`lib/resend.ts:30`).
- **Corpo:** respostas em tabela, data/hora, origem (UTM), eventos registrados,
  botão apontando para `wa.me` (mesmo `toWhatsAppDigits` de `lib/phone`).
- **Linha de origem some quando não há UTM**, espelhando o self-hide do
  `buildMessage`. A maioria dos leads chega sem UTM.
- **Parte em texto puro** junto do HTML (`text` no payload da Resend), por
  entregabilidade.
- **Escape de HTML obrigatório** no conteúdo do lead. O canal WhatsApp não tinha
  esse risco; o e-mail tem. Combinar `escapeHtml` (`lib/html`) com o saneamento
  de caracteres invisíveis que o `buildMessage` já faz.

### Fase 3 — Alerta de abandono por e-mail

Precisa de **caminho de seleção próprio** (não ancorado em
`form_whatsapp_settings`) e de **controle de duplicata próprio por canal**.

Se os dois canais dividirem o mesmo claim em `form_whatsapp_logs`, enviar o
e-mail faz o WhatsApp acreditar que já avisou — e vice-versa. Ver seção 6,
pergunta 3.

Gate: Plus+ (`emailNotifications`).

### Fase 4 — Testes e vitrine

Testes para: formato do assunto, self-hide da linha de origem, escape de HTML com
conteúdo hostil no campo de nome, não-duplicidade entre dono e `notify_email`, e
independência do claim entre canais.

Vitrine: acrescentar o alerta de abandono ao Plus. `lib/plan-marketing.test.ts`
exige lastro em `PLANS` para todo bullet novo — pode ser necessário um flag novo
em `plan-definitions.ts` e uma regra em `CLAIM_RULES`.

**Ordem de entrega proposta:** Fases 1, 2 e 4 primeiro (diretas, resolvem a
notificação do dia a dia); Fase 3 depois, separada, por ser onde dá para errar
feio.

---

## 5. RISCOS QUE EU JÁ ENXERGO

1. **Duplicidade no abandono** (o maior). Claim compartilhado entre canais faz um
   cancelar o outro. Claim separado sem cuidado faz o cliente receber o mesmo
   alerta duas vezes.
2. **Idempotência incompleta na fusão.** A chave atual não inclui o
   destinatário; ao fundir as duas funções, dois envios legítimos para pessoas
   diferentes podem colidir.
3. **Injeção via conteúdo do lead.** Campo de nome com HTML entra no corpo do
   e-mail. Também vale para o assunto (injeção de cabeçalho).
4. **Entregabilidade.** E-mail rico, com link externo e tabela, tem mais chance de
   cair em spam que o atual, que é quase vazio. Sendo o único canal, isso deixou
   de ser detalhe.
5. **Custo/volume na Resend.** Não levantei o plano atual da conta nem se há
   limite mensal relevante.
6. **Serverless.** `app/api/responses/route.ts` acumula promises e aguarda
   (comentário na linha 548) justamente porque side-effect fire-and-forget é
   abortado quando a resposta HTTP termina. Um corpo de e-mail mais caro de montar
   entra nesse caminho crítico.

---

## 6. PERGUNTAS ESPECÍFICAS

1. **Fusão dos dois e-mails:** manter uma função com lista de destinatários, ou
   uma função por destinatário com chave de idempotência distinta por e-mail?
   Qual quebra menos o comportamento atual de deduplicação?

2. **`lib/notification-content.ts` consumindo `buildLeadData`:** vê algum
   acoplamento ruim nisso? `buildLeadData` vive em `integration-stubs.ts` junto de
   coisas de WhatsApp — vale extrair para um módulo neutro antes?

3. **Claim do abandono.** Três opções na mesa:
   - (a) coluna `channel` em `form_whatsapp_logs` + índice único
     `(form_id, response_id, status, channel)`
   - (b) tabela nova `form_notification_logs`, com o WhatsApp migrando depois
   - (c) status distinto, ex. `abandoned_alert_email`, na mesma tabela
   Qual você escolheria, considerando que o cron roda a cada 15 min, pode ter
   instâncias concorrentes, e que a tabela hoje se chama `form_whatsapp_logs`?

4. **Seleção do abandono para e-mail.** Hoje a query parte de
   `form_whatsapp_settings`. Para e-mail o critério passa a ser
   `forms.notify_email_enabled` / dono com plano Plus+. Isso muda o volume varrido
   a cada 15 min — há risco de custo ou de timeout no timer? Como você
   estruturaria a query para servir aos dois canais sem duplicar a varredura?

5. **Eventos de conversão.** Qual a forma honesta de rotular
   `meta_events` no e-mail, sabendo que a auditoria de 2026-07-28 registrou que
   há um `META_PIXEL_ID` GLOBAL, que todo evento sai como `Lead` e que o
   `event_id` é o NOME do evento (sem dedup real com o browser)?

6. **Algo que eu não perguntei** e que você considera risco real.

---

## 7. RESTRIÇÕES DA CASA

- Repo: `/home/sidney/eidosform`, `main` = `2c814ec`.
- Suíte: 788 testes. `npm run build` precisa passar.
- **Não mexer no gate de WhatsApp** (`lib/whatsapp-capability.ts` e os pontos que
  o consomem). Está no ar, validado, e é assunto encerrado.
- **Não reintroduzir promessa de notificação por WhatsApp** em lugar nenhum.
  `lib/plan-marketing.test.ts` quebra de propósito se isso acontecer.
- Regra vigente: nunca redigitar lista de plano em componente — importar de
  `lib/plan-marketing.ts`.
- Deploy é `git push` na `main` → Vercel automático. Não usar `vercel --prod`.
