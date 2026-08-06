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
