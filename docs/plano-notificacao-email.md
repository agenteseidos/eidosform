# PLANO — Notificações por E-MAIL do EidosForm

**Data:** 2026-07-30
**Para:** sessão do Claude Code que vai implementar
**Repo:** `/home/sidney/eidosform` — `main` = `2c814ec`
**Origem:** análise minha + parecer do Codex sobre
`docs/briefing-notificacao-email-2026-07-30.md`

> O briefing original fica no repo como registro histórico. Ele contém **um erro
> já corrigido**: afirma que a rota de respostas aguarda as notificações de forma
> síncrona, quando o código usa `after()`. Este documento é a versão correta e
> auto-suficiente — na dúvida, siga este e o código.

---

## 0. COMO USAR ESTE DOCUMENTO

O trabalho está dividido em **duas entregas sequenciais**, com validação do Sidney
no meio.

| | conteúdo | quando |
|---|---|---|
| **Entrega 1** (seção 4) | modelo neutro, sender endurecido, fusão dos dois e-mails, conteúdo rico, testes | **agora** |
| **Entrega 2** (seção 5) | alerta de lead abandonado por e-mail, tabela nova, claim por destinatário, vitrine | **só depois** da Entrega 1 validada |

**Execute a Entrega 1 e PARE.** Não comece a Entrega 2 por conta própria: existe
um ponto de revisão deliberado entre as duas, porque a segunda é onde dá para
errar feio e ela depende do que a primeira produzir.

As seções 1, 2, 3, 6, 7 e 8 valem para as duas.

---

## 1. REGRAS DE OPERAÇÃO — leia antes de tocar em qualquer arquivo

1. **PARE NA BRANCH.** Implemente, teste, deixe verde e pare. **Não faça merge na
   `main`. Não dê push na `main`. Não faça deploy.** Push na `main` dispara deploy
   automático na Vercel, e o e-mail é hoje o único canal de notificação do cliente
   pagante — erro vai direto para produção.
2. **Trabalhe numa worktree/branch isolada.** Pode haver outra sessão ativa neste
   repositório. Sugestões: `feat/notificacao-email-rica` (Entrega 1),
   `feat/alerta-abandono-email` (Entrega 2).
3. **NÃO altere a copy de `app/v3/page.tsx` nem de `app/v4/page.tsx`.** Você vai
   notar que a FAQ dessas páginas (linha 223 em ambas) já promete o conteúdo rico
   **e** o alerta de abandono. **Isso é conhecido e foi decisão explícita do
   Sidney: não mexer.** Não "conserte", não abra exceção, não comente no código.
   Quando a Entrega 2 subir, aquele texto passa a ser verdade sozinho.
4. **NÃO toque no gate de WhatsApp** — `lib/whatsapp-capability.ts` e os pontos
   que o consomem (`app/api/whatsapp/send/route.ts`, `app/api/responses/route.ts`,
   `app/api/cron/abandoned-leads/route.ts`). Está no ar, validado em produção,
   assunto encerrado.
5. **Nada de promessa de WhatsApp voltando à vitrine.** `lib/plan-marketing.test.ts`
   derruba o build de propósito se isso acontecer.
6. Comandos: `npm test` (vitest run) e `npm run build`. Ambos precisam passar.
7. **Se alguma premissa deste documento não bater com o código, PARE e relate**
   em vez de improvisar. Já aconteceu uma vez: o briefing original afirmava que a
   rota era síncrona e o código já usava `after()`. A evidência do código vale
   mais que este documento.

---

## 2. POR QUE ISTO EXISTE

Em 2026-07-30 a notificação de lead **por WhatsApp foi removida do produto** e
restringida a uma allowlist de UUIDs (só a conta do Sidney). O transporte
não-oficial levou a linha a uma **restrição de conta de 6 horas**, depois de três
revogações de dispositivos vinculados.

Consequência: **o e-mail passou a ser o único canal de notificação do cliente.** E
o e-mail atual é praticamente vazio — manda o título do formulário e um botão. O
cliente precisa abrir o navegador e logar para descobrir se o lead vale algo.

Este plano faz o e-mail dizer o que o WhatsApp dizia, e devolve ao produto o
alerta de lead abandonado — que hoje só existe na conta do Sidney.

---

## 3. ESTADO ATUAL — com evidência

### 3.1 Existem DOIS e-mails de "nova resposta", divergentes

Ambos disparados de `app/api/responses/route.ts`:

| | `lib/resend.ts` → `sendNewResponseNotification` | `lib/notify.ts` → `sendEmailNotification` |
|---|---|---|
| destinatário | dono da conta (`ownerProfile.email`) | e-mail do form (`form.notify_email`) |
| chamada | `app/api/responses/route.ts:556` | `app/api/responses/route.ts:587` |
| idempotência | sim — `sha256(new-response:formId:responseId)` | **não** |
| retry | sim — `sendEmailWithRetry` | **não** — `fetch` cru |
| identidade visual | `#6366f1` | `#1E3A5F` + `#F5B731` |

Conteúdo do primeiro (`lib/resend.ts:141-152`), na íntegra:

```
Nova resposta recebida! 🎉
Seu formulário <TÍTULO> recebeu uma nova resposta.
[Ver resposta]
```

Assunto de ambos: `Nova resposta em "<título>"` — idêntico para todo lead, o que
torna a triagem na caixa de entrada impossível.

Deduplicação atual entre os dois: `form.notify_email !== ownerProfile?.email`
(`app/api/responses/route.ts:579`) — comparação **exata**, sensível a caixa e
espaços. `notify_email` é salvo em minúsculas (`lib/form-integrations.ts:38`), mas
não confie nisso: normalize de novo.

### 3.2 O modelo de dados atual é WhatsApp-específico

`lib/integration-stubs.ts:34` → `buildLeadData` monta o pacote que
`buildMessage` consome. **Não dá para consumir essa saída no e-mail**, porque:

- passa `sink: 'whatsapp'` explicitamente (`lib/integration-stubs.ts:51`)
- monta `respostas` como **Markdown do WhatsApp**, com `*pergunta*` e quebras de
  linha (`lib/integration-stubs.ts:60-62`)
- o formatter só conhece os sinks `'whatsapp'` e `'export'`
  (`lib/answer-format.ts:18`)

Se o e-mail consumir isso direto, o cliente recebe `*Qual seu nome?*` literal.
**Mover a função de arquivo não resolve — seria WhatsApp com nome neutro.**

O arquivo também mistura envio por WhatsApp e dependências de Supabase/logging com
a construção do modelo.

### 3.3 O horário está errado por construção

`buildLeadData` usa `new Date()` **no momento do envio**
(`lib/integration-stubs.ts:140`). Numa nova tentativa, o e-mail mostra a hora da
notificação como se fosse a hora do lead. O correto é o horário persistido:
`responses.submitted_at` para resposta completa, `last_activity_at` para abandono.
Ambas as colunas existem (`lib/database.types.ts:637,648`).

### 3.4 O sender precisa ser endurecido

`lib/resend.ts`:

- **Retry indiscriminado**: repete qualquer resposta não-ok, inclusive 4xx
  permanente (linhas 83-114). Deveria repetir só timeout, 408, 429 e 5xx.
- **Sem timeout**: o `fetch` não tem `AbortSignal`.
- **`sanitizeSubject` fraco** (linhas 20-38): remove CPF, e-mail e telefone e
  trunca em **50 caracteres**. Não remove CR/LF, `\p{Cc}` nem `\p{Cf}` — não
  protege contra injeção de cabeçalho. E 50 caracteres decepa qualquer assunto
  rico.
- **PII em log**: `console.log('[resend] email sent', { to, subject })` (linha
  100). Com o nome do lead no assunto, o nome vai para o log de infraestrutura. A
  base de clientes é de psicólogos.

### 3.5 O pós-submit já é assíncrono, mas não é durável

A rota usa `after()` (`app/api/responses/route.ts:727`): responde ao navegador e
roda as notificações depois. As promises são **iniciadas antes** do `after()` (nos
`postSubmitTasks.push(...)`), então a montagem do conteúdo acontece no caminho da
requisição.

**Não existe fila durável para e-mail.** Se a execução morrer, a resposta fica
gravada e o aviso desaparece sem nova tentativa. Isso não se resolve na Entrega 1
— mas não piore: mantenha a montagem barata e sem I/O extra. A Entrega 2 cria a
tabela que pode virar essa fila depois.

Contexto real: em 2026-07-30 a fila do WhatsApp segurou **9 leads** durante a
restrição de 6 h da linha. O e-mail não tem equivalente.

### 3.6 O cron de abandono é 100% moldado em WhatsApp

`app/api/cron/abandoned-leads/route.ts`:

- **Seleção parte de `form_whatsapp_settings`** com `enabled = true` (linhas
  241-243). Formulário sem WhatsApp configurado **nunca é considerado**.
- Filtro de capacidade **antes do claim** (linha 267):
  `(forms ?? []).filter(f => canUseLeadWhatsApp(f.user_id))`
- **Claim atômico** = INSERT em `form_whatsapp_logs` com
  `status: 'abandoned_alert'` (linhas 394-402). Conflito `23505` = outra instância
  ganhou a corrida; não é falha.
- Colunas do claim: `form_id`, `response_id`, `phone_number`, `message_sent`,
  `status`, `wacli_message_id`, `error_message` — todas WhatsApp-específicas.

**Índice único** (`supabase/migrations-manual/2026-07-23-notificacoes-whatsapp.sql:37`):

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uniq_abandoned_alert_per_response
  ON form_whatsapp_logs (response_id) WHERE status = 'abandoned_alert';
```

Um alerta por resposta. O ciclo de vida vem do código: `wacli_message_id IS NULL`
= pendente (lease em `created_at`); preenchido = enviado.

**É por isso que não dá para "só adicionar e-mail".** Se os dois canais dividirem
esse claim, enviar o e-mail faz o WhatsApp acreditar que já avisou — e vice-versa.

**Filtro de elegibilidade exige telefone**: `isActionable` (linha ~305) só
considera alertável o lead com telefone válido (`toWhatsAppDigits`). **Não
reutilize** — descartaria leads perfeitamente notificáveis por e-mail.

**Limites calibrados para WhatsApp** (linhas 45-60):

| constante | valor | observação |
|---|---|---|
| `LOOKBACK_HOURS` | 72 | janela de varredura |
| `BATCH_LIMIT` | 4 | **máx. 16 alertas/hora** (timer roda a cada 15 min) |
| `PAGE_SIZE` | 50 | página do cursor |
| `MAX_PAGES` | 20 | teto por run |
| `LEASE_MS` | 10 min | claim pendente mais velho é retomável |
| `ROUTE_BUDGET_MS` | 25 s | `vercel.json` fixa `maxDuration=30` |
| `MIN_SEND_BUDGET_MS` | 9 s | não começa envio sem isto sobrando |

Agendamento: timer systemd `eidosform-abandoned.timer`, a cada 15 min (conta
Vercel é Hobby: máx. 2 crons, só diários — ver `DEPLOY.md`).

**Conteúdo do alerta já existe em versão WhatsApp**
(`lib/whatsapp-template.ts:26-34`). Note a semântica correta, herdada da auditoria
P2-8: **"sem atividade há X min"**, não "começou a preencher há X min" — o lead
pode ter mexido por 20 minutos e parado há 30. Preserve essa honestidade.

### 3.7 Não existe índice adequado para a varredura

`supabase/schema.sql:54-55` tem apenas:

```sql
CREATE INDEX idx_responses_form_id ON responses(form_id);
CREATE INDEX idx_responses_submitted_at ON responses(submitted_at DESC);
```

Não há índice parcial composto para a consulta de abandono. Ampliar a base varrida
sem índice é risco real de custo e de timeout.

### 3.8 Gate de plano

`lib/plan-definitions.ts` → `emailNotifications`: Free `false` (59),
Starter `false` (81), Plus `true` (104), Professional `true` (126).

**Mantenha como está.** Foi decisão do Sidney hoje.

Vitrine (`lib/plan-marketing.ts:107`): `'Notificação por email'` aparece só no
Plus. Starter e Free não prometem notificação — a vitrine já é honesta nisso.

---

## 4. ENTREGA 1 — e-mail rico

### 4.1 Escopo

**Dentro:** modelo neutro, adaptadores, sender endurecido, fusão dos dois
e-mails, conteúdo rico (assunto, HTML, texto puro), testes.

**Fora:** alerta de abandono, tabela `form_notification_logs`, qualquer alteração
em `app/api/cron/abandoned-leads/route.ts`, vitrine, copy.

**Mas projete pensando na Entrega 2:** o modelo neutro precisa acomodar o evento
de abandono sem redesenho.

### 4.2 Modelo neutro

Novo módulo (sugestão: `lib/notification-model.ts`), sem dependência de canal, sem
Supabase, sem logging. Formato sugerido — ajuste se achar melhor, mas mantenha a
natureza neutra:

```ts
export interface NotificationModel {
  form: { id: string; title: string }
  response: {
    id: string
    link: string
    /** Horário PERSISTIDO do evento. Nunca new Date(). */
    eventAt: string
  }
  identity: { name?: string; email?: string; phone?: string }
  /** Respostas como pares, SEM formatação de canal. */
  answers: Array<{ question: string; value: string }>
  utm: { source?: string; medium?: string; campaign?: string; term?: string; content?: string }
  /** Nomes registrados na resposta. NÃO é confirmação de entrega. */
  conversionEvents: string[]
  /** Reservado para a Entrega 2. */
  inactiveMinutes?: number
}
```

Os valores continuam usando a formatação humana que já existe
(`lib/answer-format.ts`); o que muda é que o **par** sai cru e cada canal decide
como apresentar.

### 4.3 Adaptadores

- **WhatsApp**: transforma o modelo no `leadData` que `buildMessage` já espera.
  `buildLeadData` passa a derivar do modelo neutro.
- **E-mail**: novo módulo (sugestão: `lib/notification-content.ts`) que devolve
  `{ subject, html, text }`.

**Invariante crítica:** a mensagem de WhatsApp gerada depois do refactor precisa
ser **idêntica** à de hoje, provada por teste (4.7, item 1). É a rede de segurança
do refactor inteiro.

### 4.4 Sender endurecido

Em `lib/resend.ts`:

- `AbortSignal.timeout(...)` no `fetch` (10 s é razoável)
- retry **apenas** em erro de rede/timeout, 408, 429 e 5xx — 4xx não repete
- `sanitizeSubject` reforçado: remover `\p{Cf}`, converter `\p{Cc}` (inclui CR/LF)
  em espaço, colapsar espaços, **depois** aplicar os padrões de PII existentes, e
  só então truncar. **Suba o limite de 50 para ~78 caracteres.**
- aceitar e enviar `text` junto do `html`
- **log sem PII**: não registre assunto completo nem destinatário em claro (hash
  ou domínio), preservando a utilidade para depuração
- **preserve** o `Idempotency-Key` que já existe

### 4.5 Orquestrador de destinatários

Uma função de baixo nível **por destinatário** e um orquestrador fino que:

1. monta a lista (dono + `notify_email`, quando habilitado)
2. normaliza com `trim().toLowerCase()`
3. deduplica com `Set`
4. chama o sender **uma vez por destinatário**

Chave de idempotência **por destinatário**:

```
sha256(`new-response-email:v1:${formId}:${responseId}:${emailNormalizado}`)
```

O e-mail entra no hash; não precisa aparecer em claro.

**Não** use uma única chamada da Resend com vários destinatários: prejudica
privacidade (um vê o outro), rastreabilidade, retry e idempotência individual.

`lib/notify.ts` deixa de existir (ou vira wrapper fino). Um construtor só.

### 4.6 Conteúdo

**Assunto:** `Novo lead: {nome} — {título do formulário}`. Sem nome coletado:
`Novo lead em {título do formulário}`. O nome vem **primeiro** de propósito: se
truncar, o que importa sobrevive.

**Corpo (HTML):**
- linha de prévia (preheader) com nome e telefone
- respostas em **tabela** (pergunta / resposta)
- data e hora do evento, em horário de Brasília, vindos de `eventAt`
- **origem (UTM): a linha só aparece quando há pelo menos uma UTM.** A maioria dos
  leads chega sem UTM; "Origem: —" em todo e-mail é ruído. Espelha o self-hide de
  `buildMessage` (`lib/whatsapp-template.ts:87`).
- **sinais de conversão**, só quando houver. Rótulo obrigatório:

  > Sinais de conversão registrados nesta resposta: Lead Qualificado, Agendamento
  >
  > *Indica os eventos registrados pelo EidosForm; não confirma recebimento pelas
  > plataformas de anúncios.*

  **Não** escreva "Eventos Meta", "eventos disparados" nem "eventos entregues".
  Motivo objetivo: os nomes entram no POST **antes** de os pixels do navegador
  dispararem (`components/form-player/form-player.tsx:725,784`); o servidor só
  valida que cada item é string (`app/api/responses/route.ts:136`); e na CAPI todo
  evento sai como `event_name: 'Lead'`, com o nome original virando `event_id`
  (`lib/meta-capi.ts:100`). O servidor conhece os nomes registrados, não o
  resultado nos provedores.
- **botão de WhatsApp** para `https://wa.me/<digitos>`, via `toWhatsAppDigits` de
  `lib/phone`. Some quando não há telefone válido. (Decisão do Sidney: **sem
  `reply_to`** — no celular, tocar no botão abre o WhatsApp direto.)
- botão "Ver no painel", que já existe hoje

**Corpo em texto puro:** versão equivalente, no mesmo payload.

**Escape obrigatório.** Tudo que vem do lead entra em HTML: nome, título do
formulário, **títulos das perguntas**, respostas, UTMs, nomes de eventos, nomes de
arquivo e URLs. Use `escapeHtml` (`lib/html`) combinado com a limpeza de
caracteres invisíveis de `lib/whatsapp-template.ts:64-84`. Assunto e HTML exigem
tratamentos **diferentes** — não reaproveite um sanitizador para os dois.

### 4.7 Testes da Entrega 1

1. **Regressão do WhatsApp**: mensagem idêntica à atual, num caso completo e num
   caso sem telefone/sem eventos.
2. Assunto: com nome, sem nome, e com título longo (truncamento).
3. `sanitizeSubject`: remove CR/LF e controle; PII segue mascarada.
4. Escape de HTML com entrada hostil (`<script>`, `<img onerror>`) em nome, título
   de pergunta e resposta — no HTML **e** no texto puro.
5. Self-hide da linha de origem sem UTM; presença com uma só.
6. Deduplicação: dono e `notify_email` iguais a menos de caixa/espaços = **um**
   envio.
7. Chave de idempotência **difere** entre destinatários e é **estável** para o
   mesmo.
8. Retry: 4xx não repete; 500 repete; timeout aborta.
9. Horário: usa `submitted_at`, não o relógio do envio.

Nota: os testes atuais da rota usam de propósito respostas **incompletas** para
pular as integrações pós-submit (`app/api/responses/route.test.ts:96`). Ou seja,
hoje **não existe** teste do caminho dono + e-mail adicional. Se der para cobrir
sem reescrever o mundo, cubra; se ficar caro, teste no nível das funções novas e
diga no relatório o que ficou descoberto.

### 4.8 Pronto (Entrega 1)

- `npm test` verde (788 testes hoje; o número só sobe) e `npm run build` passa
- `lib/notify.ts` não é mais um segundo construtor
- mensagem de WhatsApp idêntica, provada por teste
- branch própria, **sem merge e sem push na `main`**

**Pare aqui e reporte.** A Entrega 2 só começa depois da validação do Sidney.

---

## 5. ENTREGA 2 — alerta de lead abandonado por e-mail

> **NÃO COMECE** sem a Entrega 1 concluída, revisada e aprovada. Esta seção foi
> escrita **antes** da Entrega 1 existir: nomes de módulo e formato do modelo são
> sugestões. **Reconfira tudo contra o código real antes de escrever uma linha.**

### 5.1 O que é e por que importa

Avisar o dono quando alguém **começou a preencher e parou**, com o que já foi
respondido, a tempo de recuperar o lead. Hoje existe só por WhatsApp — ou seja, só
na conta do Sidney. Nenhum cliente pagante recebe.

É **exclusivo Plus+** e passa a ser o argumento de upgrade que a vitrine perdeu
quando o WhatsApp saiu.

### 5.2 Escopo

**Dentro:** tabela `form_notification_logs`, índice de varredura, seleção própria
para e-mail, envio, vitrine (**só depois de funcionar**), testes.

**Fora:** migrar o WhatsApp para a tabela nova — o cron dele está estabilizado;
**não mexa além do estritamente necessário**. E não transforme a tabela em fila
durável de `new_response` agora; só **projete** para que caiba depois.

### 5.3 Tabela `form_notification_logs`

Migração **manual**, no padrão da casa: arquivo em `supabase/migrations-manual/`
com data no nome, cabeçalho explicando o problema, por que é segura e o que muda.
O Sidney roda no SQL Editor do Supabase. **Não presuma que rodou.**

| campo | papel |
|---|---|
| `response_id` | resposta que originou |
| `form_id` | formulário |
| `event_type` | `new_response` \| `abandoned` |
| `channel` | `email` (coluna já nasce preparada para outros) |
| `recipient_role` | `owner` \| `form_email` |
| `recipient_hash` | hash do destinatário — auditoria sem expor endereço |
| `status` | `pending` \| `sent` \| `failed` |
| `attempts` | contador |
| `created_at` | serve de lease, como no cron atual |
| `provider_message_id` | id devolvido pela Resend |
| `error_message` | último erro |

**Unicidade:**

```sql
UNIQUE (response_id, event_type, channel, recipient_role)
```

**Por que por destinatário e não só por canal:** uma resposta pode gerar **dois
e-mails legítimos** — dono e endereço adicional. Claim só por canal bloquearia o
segundo. Ao mesmo tempo, se os dois normalizarem para o **mesmo** e-mail, deve
existir **um só** destinatário e um só claim — deduplique **antes** de criar o
claim.

**Projete para virar fila durável** (ver 3.5): `status`/`attempts`/`created_at`
devem permitir que `new_response` passe a ser registrado aqui depois, sem
redesenho.

### 5.4 Índice de varredura

Antes de ampliar a base varrida, valide com `EXPLAIN` algo na linha de:

```sql
CREATE INDEX ... ON responses (form_id, last_activity_at, id)
  WHERE completed = false;
```

Ajuste ao formato real da consulta. **Não confie no índice sem medir** — o ganho
precisa aparecer no plano de execução.

### 5.5 Seleção própria para o canal e-mail

**A regra não é `forms.notify_email_enabled`.** Pelo comportamento atual
(`app/api/responses/route.ts:552` e `:577`):

- **todo** formulário de dono Plus+ notifica **o e-mail do dono**;
- `notify_email_enabled` apenas **acrescenta um segundo destinatário**.

Arquitetura recomendada:

1. resolver os formulários elegíveis por canal
2. unir os ids
3. varrer `responses` incompletas **uma vez**, com cursor estável
   (`last_activity_at`, `id`)
4. aplicar a política de cada canal e criar **claims independentes por
   destinatário**
5. manter **limites de lote separados por canal**

**Na primeira versão é aceitável — e mais seguro — manter uma seleção de e-mail
separada e bem indexada, preservando integralmente o cron de WhatsApp já
validado.** A extração de um varredor neutro compartilhado vem depois, com testes.

Não reutilize `isActionable` (3.6). Não herde `BATCH_LIMIT = 4`.

### 5.6 Envio

Reaproveita o modelo neutro e o sender da Entrega 1:

- `eventAt` = `responses.last_activity_at`
- `inactiveMinutes` preenchido
- assunto: `Lead incompleto: {nome} — {título}`; sem nome:
  `Lead incompleto em {título}`
- corpo com o que já foi respondido, origem com self-hide, sinais de conversão com
  o mesmo rótulo honesto, botão `wa.me` quando houver telefone válido
- texto puro junto, escape de HTML em tudo que vem do lead

Gate: Plus+.

### 5.7 Vitrine — só depois de funcionar

Ordem obrigatória: **primeiro o alerta funcionando, depois a vitrine.**

Sugestão: novo flag em `lib/plan-definitions.ts` (ex.: `abandonedLeadAlert`),
`false` em Free e Starter, `true` em Plus e Professional; bullet novo no Plus em
`lib/plan-marketing.ts`; regra correspondente em `CLAIM_RULES` de
`lib/plan-marketing.test.ts` — a suíte exige lastro em `PLANS` para todo bullet.

Continue **sem alterar** as páginas /v3 e /v4 (regra 3 da seção 1).

### 5.8 Testes da Entrega 2

1. **Claim por destinatário**: dono e endereço adicional geram dois claims; mesmo
   e-mail (a menos de caixa/espaços) gera **um**.
2. **Independência entre canais**: o alerta por e-mail não afeta o claim de
   WhatsApp da mesma resposta, e vice-versa.
3. **Corrida**: dois runs simultâneos não enviam duas vezes (`23505` tratado como
   corrida perdida).
4. **Lease**: claim pendente vencido é retomável; recente não é.
5. **Elegibilidade**: lead **sem telefone** entra no alerta por e-mail (regressão
   direta de `isActionable`).
6. **Horário**: usa `last_activity_at`.
7. **Gate**: dono Free/Starter não recebe.
8. **Regressão do cron de WhatsApp**: comportamento inalterado.

### 5.9 Pronto (Entrega 2)

- `npm test` verde; `npm run build` passa
- migração escrita, documentada e **apresentada ao Sidney para rodar**
- `EXPLAIN` do índice registrado no relatório
- cron de WhatsApp inalterado, provado por teste
- branch própria, **sem merge e sem push na `main`**

---

## 6. DECISÕES JÁ TOMADAS — não reabrir

Todas do Sidney, em 2026-07-30, com as contrapartidas expostas. Se enxergar
consequência técnica, **relate**; não reverta.

1. **Sem `reply_to`.** O link `wa.me` fica — no celular abre o WhatsApp direto.
2. **Respostas completas vão no corpo do e-mail.** Foi levantado que a base é de
   psicólogos e que isso tira dado sensível do painel; a decisão foi prosseguir.
3. **Ambas as notificações permanecem Plus+.** Free e Starter seguem sem aviso.
4. **Não mexer na copy de /v3 e /v4**, mesmo com a divergência conhecida.
5. **Duas entregas**, com validação no meio.
6. Eventos de conversão descritos como **registrados**, nunca como entregues.
7. **Tabela nova** para o claim, sem migrar o WhatsApp agora.
8. **Claim por destinatário**, não só por canal.
9. **Vitrine só depois** do alerta funcionando.

---

## 7. ARMADILHAS CONHECIDAS

**Entrega 1**

1. **Consumir `buildLeadData` direto** → Markdown de WhatsApp no corpo do e-mail.
2. **Só mover a função de arquivo** → modelo WhatsApp com nome neutro.
3. **Manter `new Date()`** → hora do e-mail apresentada como hora do lead.
4. **Deduplicar por comparação exata** → e-mail duplicado por diferença de caixa.
5. **Idempotência sem o destinatário** → dois envios legítimos colidem e um some.
6. **Reaproveitar `sanitizeSubject` como está** → injeção de cabeçalho por CR/LF.
7. **Esquecer o escape em títulos de pergunta** — vêm do usuário, entram em HTML
   igual.
8. **Alterar a saída do WhatsApp sem perceber** — por isso o teste 1 é obrigatório.

**Entrega 2**

9. **Reutilizar o claim de `form_whatsapp_logs`** → um canal cancela o outro.
10. **Claim só por canal** → o segundo destinatário legítimo nunca é avisado.
11. **Não deduplicar antes do claim** → o mesmo e-mail recebe duas vezes.
12. **Reutilizar `isActionable`** → todo lead sem telefone é descartado.
13. **Herdar `BATCH_LIMIT = 4`** → teto artificial de 16 alertas/hora.
14. **Ampliar a varredura sem índice** → custo e timeout no timer de 15 min.
15. **Usar `submitted_at` ou `new Date()`** no abandono → horário errado.
16. **Mexer no cron de WhatsApp além do necessário** → risco na única notificação
    que hoje funciona.

---

## 8. COMO REPORTAR AO SIDNEY

Ele é o dono do produto e acompanha de perto, mas não quer jargão. Em português
claro:

- o que o cliente passa a receber que não recebia
- o que mudou no sender e por quê
- **na Entrega 2: o SQL que ele precisa rodar** e o que acontece se esquecer
- o que ficou descoberto de teste, se algo ficou
- decisões que você tomou sozinho por ambiguidade do plano
- nome da branch
