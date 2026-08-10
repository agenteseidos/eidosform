# Demandas Futuras — EidosForm

> Lista de coisas que **decidimos fazer**, mas que **não são prioridade agora**.
> Diferente de `docs/audits/` (achados de auditoria) e do backlog de correção da auditoria
> 2026-08 (`eidos-shared/auditoria-geral-2026-08/99-sintese/plano-remediacao.md`), que trata de
> defeitos. Aqui entram funcionalidades e melhorias nascidas de decisões conscientes.
>
> **Como usar:** cada item tem ID (`D-nn`), origem, o problema real que resolve, e o que já existe
> no código que pode ser reaproveitado. Item concluído sai daqui e vira registro no CLAUDE.md.

---

## D-01 · Régua de cobrança para inadimplência (e-mail + WhatsApp)

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

## D-03 · Rastreamento de migrations (`supabase_migrations`)

**Origem:** achado do Lote 0 da auditoria; cobrou o preço 4 vezes no mesmo dia.

**O problema.** Não existe registro de quais migrations rodaram. O repositório **não descreve o
banco** — e isso já causou: um achado de auditoria falso (migration que "abortava" e não abortou),
um `REVOKE` que está no arquivo e não no banco, uma assinatura de função errada que quebrou um
comando, e o achado mais grave de todos (grants amplos ao `anon`), que é invisível no código.

**O que fazer:** adotar o rastreamento do Supabase CLI, ou uma tabela própria de controle, e uma
rotina que compare o esperado com o real. Enquanto não existir, toda afirmação sobre o banco tem que
sair de consulta ao catálogo.

_Regra ativa no `CLAUDE.md`, seção "🛑 REGRA Nº 1"._

---

## D-04 · CI que roda os testes (EidosForm e Elen)

**Origem:** auditoria geral 2026-08 (E13), agravado pelo Lote 0.

**O problema.** A CI do EidosForm roda `lint`, `tsc` e `build` — **não roda `npm test`**. E a Elen,
que é repositório separado (`agenteseidos/eidos-atendente-wpp`), **não tem CI nenhuma**. As ~986 +
21 suítes nunca rodam automaticamente. Um PR que quebre os testes de durabilidade passa com CI verde.

**Por que importa agora:** as correções da auditoria estão entrando sem rede. Um `revert` acidental
de qualquer uma delas não seria detectado.

**Cuidado ao ligar:** `elen/test/followup.test.js` dá **`FLUSHDB` incondicional** antes de cada um
dos ~35 testes, com URL literal de Redis. Ligar a CI da Elen sem neutralizar isso é arriscado.

---

## D-05 · Fila de reenvio para e-mail (o "outbox" que ficou de fora do lote 3)

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

### O que NÃO foi coberto pelo navegador (verificado só por leitura de código)

- pergunta do tipo Calendly **não obrigatória**;
- ir e voltar entre perguntas **antes** de agendar (era o re-render que causava o defeito original);
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
