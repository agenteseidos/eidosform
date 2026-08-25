# BRIEFING PARA AUDITORIA — incidente `expire-plans` de 25/08/2026 e a correção proposta

Contexto: EidosForm (Next.js 16 / Supabase / Asaas / **Vercel plano Hobby**). Um teste real de
inadimplência estava em curso na conta do dono. O rebaixamento por inadimplência não aconteceu no
horário. Quero seu parecer sobre **o diagnóstico**, sobre **a correção que eu propus** (e que a
minha própria investigação recomenda descartar como resposta principal), e sobre **os defeitos que
encontrei na correção que já apliquei**.

Peço rigor na separação **medido × inferido × não determinado**. Este briefing existe porque eu
apresentei uma inferência como fato e fui cobrado por isso pelo dono.

---

## 1. O QUE ACONTECEU (só o medido)

Cenário armado na conta real (`profile 67987d5a-6259-4d47-a133-82a78a7cf391`):
`plan='plus'`, `plan_status='active'`, `plan_expires_at='2026-08-21T02:59:59+00:00'`,
`asaas_subscription_id='sub_e2a1ckw3m2m431y7'`. Carência de inadimplência = 5 dias
(`OVERDUE_GRACE_DAYS=5`, `app/api/cron/expire-plans/route.ts:33`). Logo, o rebaixamento era
devido em **25/08 a partir de 03:00:00Z (00:00 BRT)**.

| Fato | Evidência |
|---|---|
| O cron da Vercel é `{"path":"/api/cron/expire-plans","schedule":"0 3 * * *"}` — única entrada de cron do `vercel.json`. Confirmado habilitado via API, apontando para o deployment de produção, `updatedAt` 24/08 14:32. | `vercel.json`; `GET /v1/projects/eidosform/crons` |
| **Às 09:07 BRT (12:07Z) o rebaixamento NÃO tinha ocorrido**: leitura direta do banco devolveu `plan='plus'`, `plan_status='active'`, `downgraded_at=null`, `responses_limit=5000`. | PostgREST com service-role |
| Execução **manual** às 09:08 devolveu `{"ok":true,"total":1,"reverted":1,"extended":0,"skipped":0}`; perfil virou `plan='free'`, `previous_plan='plus'`, `downgraded_at='2026-08-25T12:08:16.939+00:00'`. Segunda execução imediata: `total:0`. | resposta HTTP + releitura do banco |
| A cobrança `pay_cktw434zli25sgjz` está `OVERDUE`, `dueDate=2026-08-20`, `paymentDate=null` — **sem pagamento em nenhum momento**. A única outra é `pay_0swz00ffy7mxcluf` `PENDING` `dueDate=2026-09-20`. | `GET /payments?subscription=sub_e2a1ckw3m2m431y7` |
| A Vercel documenta, no Hobby, atraso de **até 59 minutos**. O observado foi **9h+**. | docs Vercel |

**Conclusão medida:** foi o **rebaixamento** que atrasou, não apenas a notificação. O dono tinha
plano pago e cota de 5.000 respostas nove horas depois do devido.

---

## 2. A CAUSA — NÃO DETERMINADA, e por quê

**Não há como determinar.** Motivo estrutural, medido:
- Hobby não retém log de runtime.
- `GET /v3/events` do projeto só devolve `deployment`, `alias`, `env-variable`, `cert-autorenew` — **nenhum tipo de evento de execução de cron**.
- Não existe trilha de execução no repositório: `grep -rniE 'cron_run|last_run|heartbeat|last_success|job_runs' --include=*.ts --include=*.sql` → **vazio**.
- O `cron.log` da VPS só registra chamadas **originadas na VPS**. Nada nesta máquina consegue observar uma invocação vinda da Vercel. **A hipótese "a Vercel não disparou" é infalsificável a partir daqui.**

### Hipóteses ELIMINADAS (com o método)

| Hipótese | Como caiu |
|---|---|
| **A linha não estava na query** (`plan_expires_at` ainda no futuro às 03:00Z ⇒ cron correto, sem incidente) | `plan_expires_at` valia `2026-08-21T02:59:59Z` — **4 dias no passado** às 03:00:00Z de 25/08. A query `.lt('plan_expires_at', now)` a alcançaria. |
| **Skip por carência ainda dentro do prazo** | `diasDesde` ancora em `T00:00:00-03:00` e faz `floor` — só muda de valor em instantes `03:00:00Z`. Logo `diasVencido` era **idêntico** às 03:00Z e às 12:08Z; como a manual reverteu, valia ≥5 nos dois. Ressalva fechada: o `oldestDueDate` era constante (`2026-08-20`, OVERDUE, nunca pago). |
| **Extensão bem-sucedida** (sub ACTIVE ⇒ empurra a expiração) | Teria posto `plan_expires_at` no futuro e a manual devolveria `total:0`. Devolveu `total:1`. |
| **VPS fora do ar / apagão de log** | 296 linhas de outros jobs na janela 02:00–13:00Z de 25/08, incluindo `03:00:02Z [hero-followup]`, `03:01:48Z [email-retry]`, `03:05:04Z [dunning]`. |
| **Timeout do lote** | *Praticamente* descartada por raciocínio (a manual resolveu 1 candidato, ≤7 round-trips), **não medida**: o tamanho do conjunto às 03:00Z é desconhecido. |

### Hipóteses VIVAS (5, indistinguíveis)

1. `!due.ok` — consulta de OVERDUE ao Asaas falhou/timeout (`route.ts:91-97`).
2. Exceção não-404 em `getSubscription` (`:163-167`).
3. Falha de escrita da reversão **depois** de `handleDowngrade` (`:216-217`).
4. Exceção em `handleDowngrade` (`:235-238`).
5. O cron da Vercel não disparou.

> Tentei falsear 3 e 4 pelo estado dos formulários (`handleDowngrade` pausa antes de escrever o
> plano, e `recomputeActiveForms` só toca o form se o estado mudar — logo um pause às 03:00Z
> sobreviveria à manual). **O discriminador é nulo neste perfil:** ele tem exatamente 3
> formulários e o plano free permite 3, então `handleDowngrade` não pausa nada. Os 3 seguem
> `paused=false` com `updated_at` de 05/08.

**Todas as 5 são silenciosas por construção** — ver §4.

---

## 3. O ACHADO PRINCIPAL — o watchdog existia e ficou mudo por um sinal de comparação

Já existe um detector desenhado **exatamente** para este incidente:
`detectarRebaixamentoAtrasado` (`lib/dunning-engine.ts:104-109`), chamado pelo cron `dunning`
(`app/api/cron/dunning/route.ts:160-172`), que roda **a cada 30 min** via
`eidosform-dunning.timer`. Ele lê o estado ao vivo no Asaas e, se houver cobrança vencida além do
prazo **e** o plano não for `free`, reivindica um marcador diário idempotente
(`event_id = dunning-downgrade-late:{profileId}:{dia}`, UNIQUE) e dispara `sendBillingOpsAlert`
(e-mail + WhatsApp do dono). **Nunca rebaixa** — por decisão de projeto.

**Por que não disparou:**

- **Estático:** o predicado é `dias > PRAZO_DIAS`, **estritamente maior**, com `PRAZO_DIAS = 5`
  (`lib/dunning-engine.ts:24`). O `expire-plans` rebaixa em `dias >= 5` (`route.ts:108`,
  `if (diasVencido < OVERDUE_GRACE_DAYS) skip`). **O dia 5 — exatamente o dia em que o
  rebaixamento é devido — é ponto cego por construção.**
- **Empírico:** 48 execuções em 24/08 + 27 em 25/08, **todas** com `"alertasRebaixamento":0` e
  `"candidatos":2` — inclusive `2026-08-25T12:05:04Z` (09:05 BRT), 3 min antes da correção
  manual. A conta foi avaliada e o detector disse não.
- Não foi cron parado, nem exceção, nem canal: `ADMIN_ALERT_EMAIL` e `ADMIN_ALERT_WHATSAPP` estão
  configurados em produção e `sendBillingOpsAlert` (`lib/resend.ts:100-111`) manda e-mail com
  retry + espelha no WhatsApp.

**Poderia ter pego?** Só em **26/08 às 00:05 BRT**, quando `dias` vira 6 — ~24h após o devido.

**A consequência perversa (medida):** a execução manual gravou `plan='free'`, e o detector exige
`estado.plano !== 'free'`. **O alerta de D+6 nunca vai sair.** O incidente apagou a própria prova:
sem mudar o limiar, um incidente resolvido à mão jamais gera alarme.

**Cobertura de teste:** `dunning-engine.test.ts` exercita `detectarRebaixamentoAtrasado` em
`dias` = 7, 7, 3 e 9 (`:101,105,109,113`) — **nunca 5**. (`decidirAviso` *é* testado em 5,
`:66,:73` — o furo é específico do detector.)

---

## 4. POR QUE O EPISÓDIO FOI 100% SILENCIOSO

- `grep -c 'sendBillingOpsAlert' app/api/cron/expire-plans/route.ts` → **0**. É o **único cron de
  billing sem alarme próprio** — e é o que decide dinheiro. (`dunning`, `reconcile-checkouts`,
  `reconcile-subscriptions` e `sweep-received` chamam.)
- **6** caminhos incrementam `skipped` (`grep -n 'skipped++'` → linhas 95, 110, 154, 166, 223, 237).
- **2** caminhos não incrementam contador nenhum: `extErr` (`:152`) e `revErr` (`:216-217`).
  O `revErr` é o pior: os formulários já foram pausados e o plano **não** foi marcado free — o
  JSON de saída pode devolver `total > reverted+extended+skipped` **exatamente no caso em que o
  banco fica inconsistente**.
- "Logar" aqui é só `console.*` (`lib/logger.ts:29-51`) — sem banco, arquivo ou webhook. No Hobby,
  inalcançável.

**Resultado: 8 desfechos-não-felizes, todos forensicamente indistinguíveis entre si e de "não rodou".**

---

## 5. A FRAGILIDADE ESTRUTURAL — 1 job de 10 em tentativa única diária

O repositório tem **10** endpoints `/api/cron/*`. **Nove** têm agendador na VPS (crontab/systemd)
que grava resposta em `cron.log`. O décimo — `expire-plans` — era o **único** exclusivo da Vercel,
o **único** sem log auditável e o **único** de execução 1×/dia. **O `cron.log` tem ZERO ocorrências
de `expire-plans` em 72 dias consecutivos (15/06→25/08, 14.872 linhas).**

| Job | Frequência | Custo de 24h parado | Auto-recupera? |
|---|---|---|---|
| **expire-plans** | **1×/dia** | Inadimplente mantém plano pago integral — **linear no tempo, sem teto** | Sim, integral |
| reconcile-checkouts | 1×/h | **Janela perdida para sempre** (`created_at` entre now-24h e now-5min) — é o backstop de "pagou e não foi ativado" | **Não** |
| reconcile-subscriptions | 1×/h | 2 subs ACTIVE = cobrança em dobro | Sim |
| sweep-received | 1×/h | Pago-sem-ativar invisível | Sim |
| capi-outbox | 1×/h | Dedup do Meta expira em 48h | Janela finita |
| dunning | 30 min (systemd, `Persistent=true`) | Régua para; é o **único watchdog** do expire-plans | Sim |
| hero-followup | 15 min | Conveniência | Sim |
| abandoned-leads / -email | 15 min | Lookback 72h | Janela finita |
| email-retry | 5 min | Janela 48h → DLQ | Janela finita |

Outros achados medidos:
- `Persistent=true` existe **só** no timer do dunning. Um reboot pula silenciosamente as janelas de
  `abandoned-leads`, `abandoned-leads-email` e `email-retry`.
- `run-cron.sh` retorna **exit 0 mesmo em falha** (testado com HTTP 404). Nem cron nem systemd
  alertam; o erro fica legível só para humano no log.
- **Bomba-relógio de escala:** a query usa `.limit(500)` sem `ORDER BY`, sem cursor e sem
  checkpoint, com ≥2 chamadas HTTPS **sequenciais** por perfil. Em timeout, as escritas já
  commitadas ficam, o JSON nunca sai, e a execução seguinte pega um conjunto de 500 arbitrário.
- **A fronteira da carência cai no milissegundo exato do horário agendado:** `02:59:59Z` → `dias=4`
  → SKIP silencioso; `03:00:00Z` → `dias=5` → REBAIXA. Margem zero, e o lado errado é mudo.
  (Não explica **este** episódio — a Vercel atrasa, não adianta — mas é fragilidade real.)

---

## 6. A CORREÇÃO QUE EU PROPUS — e por que a investigação a rebaixa

**Minha proposta ao dono foi:** trocar a execução única diária por **de hora em hora** na VPS,
mantendo o cron da Vercel como reserva. Argumentei que "em condição normal a query alcança zero
linhas e faz zero chamadas ao Asaas".

**Correção do meu próprio argumento (medida):** perfis **em carência permanecem na fila** entre
rodadas — o ramo faz `continue` sem alterar o perfil, e as 2 chamadas ao Asaas
(`getSubscription` + `hasOverduePaymentForSubscription`) ocorrem **antes** desse ponto. Ou seja:
de 2 chamadas/dia para **48/dia por inadimplente**, crescendo linearmente com a inadimplência.
Meu "zero chamadas em condição normal" só vale quando **ninguém** está em carência.

**Contra a minha proposta:**
- **Não resolve o silêncio.** Se o endpoint falhar 24×, ninguém fica sabendo.
- **Não antecipa o rebaixamento** — a fronteira é dia-granular, então o rebaixamento correto sai no
  primeiro tick após 00:00 BRT de qualquer jeito. Frequência muda só a **latência de recuperação**.
- Troca um problema de **detecção** por força bruta de **frequência**.

**A favor:** `asaasFetch` não tem retry nem tratamento de 429 — então hoje **mais frequência é a
única forma de recuperação que existe**. Um 429 isolado custa 24 horas.
Duplicidade **não** é risco: há CAS nos dois ramos de escrita, e a 2ª execução manual devolveu
`total:0`.

### As opções na mesa

| Opção | Custo | O que **não** resolve |
|---|---|---|
| **1. Corrigir o limiar do detector** (`>` → `>=` + guarda de hora, alertando só após ~04:00 BRT para dar chance às janelas) | 1 linha + 1 teste. Reusa canal, cadência de 30 min e idempotência diária **já em produção**. Detecção cai de ~24h para ~4h. | Detecta o **efeito**, nunca a causa. Um `skipped` por 429 segue sem registro. |
| **2. Heartbeat / last-run persistido**, checado pela régua de 30 min | Construir do zero (nada existe), mas o padrão de marcador idempotente (`event_id` UNIQUE) está pronto para reuso. | Não impede a falha; só a torna visível. É o que distingue "não rodou" de "rodou e pulou" — exatamente a ambiguidade que impediu o diagnóstico. |
| **3. Alertar nos caminhos de `skipped`** | Pequeno; canal já ligado. | Se não rodou, não há `skipped` para alertar. Exige a 2 como par. Precisa separar carência (esperado) de erro. |
| **4. Hora em hora** (minha proposta) | ~96 chamadas/dia hoje; +48/dia por inadimplente. | O silêncio. E não antecipa nada. |
| **5. Manter o cron da VPS** (já aplicado) | Zero adicional. | Não é redundância real contra falhas >20 min. **Mas o valor dele não é o disparo** — é que `run-cron.sh` grava `{total,reverted,extended,skipped}` no `cron.log`: é a **única observabilidade real que existe no Hobby**. |
| **6. Vercel Pro** | Assinatura. (Decisão do dono: só ao fechar 2 assinaturas pagas.) | Compra **logs de runtime** — que é o custo real deste episódio — **não compra corretude**. Sem 1–3, um 500 pontual segue silencioso no Pro. |

**Ordem que a investigação defende:** **1 → 2 → 3**, com 4, 5 e 6 como complementos, não substitutos.

---

## 7. DEFEITOS NA CORREÇÃO QUE JÁ APLIQUEI HOJE (auto-reporte)

1. **Erro de fuso de 3h20.** Adicionei `20 3 * * *` ao crontab pensando em UTC (para casar com o
   `0 3 * * *` da Vercel). A VPS é `America/Recife (-03)` e **não há `CRON_TZ`** → dispara às
   **03:20 BRT = 06:20 UTC**, não às 00:20 BRT como diz o comentário que eu mesmo escrevi.
   (Funcionalmente cai do lado certo da fronteira, mas por acidente.)
2. **A inferência sob auditoria foi gravada como fato em dois artefatos de produção:**
   - commit `b5e21bb` (25/08 09:10:17-03:00): *"o cron da Vercel nao disparou no teste real"*
   - `/var/spool/cron/crontabs/sidney` linha 23: *"o cron da Vercel NAO disparou no teste da regua"*

   Como não existe artefato capaz de observar invocação vinda da Vercel, a afirmação é
   infalsificável. Redação sustentável: *"o expire-plans passa a rodar também na VPS; a causa do
   não-rebaixamento de 25/08 não foi determinada."*
3. O backstop da VPS **ainda não disparou nenhuma vez** (primeiro disparo previsto: 26/08 06:20Z).
   Nenhuma afirmação de "está resolvido" é sustentável antes disso.

---

## 8. O QUE EU QUERO DE VOCÊ

1. **O diagnóstico se sustenta?** Em especial: a eliminação da hipótese benigna (linha fora da
   query) e da hipótese de carência estão corretas, ou há furo no raciocínio?
2. **A ordem 1 → 2 → 3 é a certa?** Ou você inverteria — por exemplo, heartbeat antes do limiar,
   já que o limiar só detecta o efeito?
3. **A guarda de hora** proposta para o detector (`dias >= 5` + só alertar após ~04:00 BRT) é
   suficiente para evitar falso positivo, ou o desenho correto é comparar contra um heartbeat em
   vez de contra a hora do relógio?
4. **Os 2 ramos sem contador** (`extErr`, `revErr`) — o `revErr` deixa o banco inconsistente
   (forms pausados + plano pago) sem incrementar nada. Isso merece prioridade acima de 1–3?
5. **Vale desacoplar o horário do cron da fronteira da carência** (hoje coincidem no
   milissegundo), ou é ruído?
6. **A bomba-relógio do `.limit(500)`** merece correção agora (cursor/checkpoint/`ORDER BY`) ou é
   dívida aceitável enquanto a base é pequena?
7. Alguma coisa que eu **não** perguntei e deveria ter perguntado?

**Restrições do projeto:** o dono não é programador; o produto ainda não tem clientes pagantes;
Vercel Pro só ao fechar 2 assinaturas; o projeto valoriza **falhar alto** em vez de degradar em
silêncio; toda mudança de banco passa pelo SQL Editor com o dono rodando (não há psql/CLI na VPS).
