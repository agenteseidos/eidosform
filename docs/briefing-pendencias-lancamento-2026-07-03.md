# Briefing técnico — Pendências de lançamento do EidosForm (auditoria 2026-07-03)

> **REV 2 (2026-07-03, tarde) — parecer do Codex INCORPORADO.** O Codex auditou a REV 1 e
> apontou 4 correções materiais, todas verificadas no código e aplicadas abaixo: (1) replay de
> webhook não testa o backstop (dedup por `body.id` mata o replay) — trocado por fault
> injection no sandbox; (2) idempotência bem implementada (44/44 testes direcionados passaram
> na máquina do Codex), mas teste real continua bloqueador; (3) comparativo não está em
> componente — é inline duplicado em v3/v4; (4) o item `normalizeLooseUrl` estava factualmente
> errado — URLs JÁ são normalizadas por `ensureHttps` locais; a pendência real é consolidar a
> duplicação. Ordem de execução recomendada pelo Codex no fim do documento.
>
> Documento originalmente para análise do Codex. Origem: auditoria completa (5 agentes, ~91
> checagens no código e em produção) pedida pelo Sidney para descobrir tudo que falta antes de
> começar a **vender de verdade** (hoje: em produção, capaz de cobrar, **zero vendas reais** —
> nada foi divulgado ainda).

---

## 1. 🔴 Bloqueador — confirmação E2E do billing pós-hardening de 15/06 nunca fechada por escrito

### O achado
O redesenho "cancelar+recriar via token" (`docs/redesenho-upgrade-downgrade.md`) foi
implementado em 10/06 (`6f0d895` e seguintes) e **reescrito para idempotência** em 15/06
(`f58a00d`, `9682754`, `f1bba35`, `00a2812` — corrige P0-A: risco de cobrança avulsa duplicada
em retry/crash durante troca de plano). **Não existe nenhum registro** — commit, doc ou
checklist marcado — confirmando que a versão **pós-15/06** foi validada com dinheiro real:

- `CLAUDE.md` afirma "tudo testado com dinheiro real" (seção datada de 10/06), mas isso é
  **antes** do hardening de idempotência — descreve uma versão anterior do código.
- `docs/smoke-test-real.md` — Fases 1, 2 e 3 inteiras com checkbox `[ ]` (não marcadas). Só
  2 dos 5 itens da Fase 0 (ensaio em sandbox) estão `[x]`.
- O roteiro de teste real do redesenho (`docs/redesenho-upgrade-downgrade.md`, seção
  "Roteiro do TESTE ÚNICO em produção", linhas 63-90) também nunca foi executado/registrado
  como concluído.
- A ficha de memória do projeto (`segundo-cerebro/projetos/eidosform.md`, seção "CORREÇÃO DE
  STATUS 2026-06-29") registra que o Sidney confirmou pendência de testes de compra/upgrade,
  e aponta como **único item específico** citado por ele: validar a idempotência sob
  **"webhook atrasado/duplicado"** no caminho de troca paga (o motivo do hardening de 15/06).

### Gap específico que o roteiro atual NÃO cobre
O "Roteiro do TESTE ÚNICO em produção" (`docs/redesenho-upgrade-downgrade.md:63-90`) testa o
**happy path** (compra → upgrade → downgrade → cancelar → estornar), incluindo o gate manual
P0-2 (confirmar no painel Asaas que a sub nova de upgrade não gera cobrança imediata). Ele
**não** inclui nenhum passo para simular um webhook que chega atrasado ou duplicado durante uma
troca de plano — que é exatamente o cenário que o hardening de idempotência de 15/06 foi feito
para proteger, e o único caso de borda que o Sidney citou como pendente em 29/06.

### Tokenização — não é bloqueio externo
A tokenização Asaas já foi liberada em produção (protocolo 1238651, confirmado em
`docs/redesenho-upgrade-downgrade.md:3`, 10/06). Não há sinal de bloqueio por terceiro hoje —
falta apenas confirmar que ela **segue ativa** (checar se os logs de produção mostram
`card token capturado`, não `card token AUSENTE` — mensagem já existe no código via `999f296`).

### ✅ Parecer do Codex (2026-07-03) — como testar de verdade
1. **Replay de webhook NÃO serve** (a proposta original da REV 1 estava errada): o endpoint
   deduplica por `body.id` antes de chegar ao fluxo de troca
   (`app/api/webhooks/asaas/route.ts:431`) — reenviar o mesmo payload testa só a deduplicação,
   não provoca cobrança nem exercita a recuperação "cobrou e morreu antes de trocar". Alterar
   o `body.id` para o evento parecer novo seria injeção sintética em produção — **não fazer**.
   (Nota: a autenticação nativa é `asaas-access-token`; o HMAC é fallback legado —
   `route.ts:383`.)
2. **Caminho correto: fault injection no SANDBOX** — criar um ponto controlado de falha entre
   a confirmação do pagamento avulso e o `executePlanSwitch`, e provar que o backstop recupera
   a troca ("cobrou e morreu" → backstop completa ou alerta). O cenário de crash/atraso não é
   reproduzível com segurança em produção; ensaia-se no sandbox.
3. **O ciclo real pode continuar ÚNICO** (compra → upgrade → downgrade → cancelamento →
   estorno), como já roteirizado — o caso de borda fica coberto pelo ensaio de fault injection
   no sandbox, sem segunda rodada de cobrança real.
4. **Idempotência revisada pelo Codex (2ª opinião de código):** bem implementada — lock por
   perfil, `attemptId` único por tentativa, lookup antes de cobrar de novo, rechecagem após
   erro ambíguo de rede, CAS na troca da assinatura, backstop distingue tentativa atual de
   superseded, estorno + DLQ em falhas financeiras (`app/api/checkout/[plan]/route.ts:260`,
   `lib/plan-switch.ts:329`). **44/44 testes direcionados passaram.** Ainda assim o teste real
   permanece bloqueador — especialmente para tokenização ativa e ausência de cobrança imediata
   na assinatura futura (GATE P0-2).

---

## 2. 🟡 Decisão de landing — qual versão vira a `/` oficial

### O achado
Hoje só a `v1` (`app/page.tsx`) está de fato indexável e recebendo tráfego; `v2`, `v3` e `v4`
existem no código e estão publicadas (`/v2`, `/v3`, `/v4`, todas HTTP 200), mas com
`noindex,nofollow` — nenhuma foi tecnicamente promovida a página principal.

- **v1** — tema escuro, proposta genérica, sem depoimentos, sem seção de Migração, sem
  comparativo com concorrentes.
- **v2** — copy BR vs "gringas", personas, demo interativa — mas com **5 depoimentos
  placeholder literais não corrigidos** (`components/v2/testimonials-section.tsx:19-55`,
  ex.: "Nome da Pessoa 1"). **+2 riscos achados pelo Codex:** o FAQ afirma **TLS 1.3 e
  AES-256** sem evidência apresentada (`app/v2/page.tsx:159`) — verificar antes de publicar ou
  reescrever a resposta; e a copy "gringas" fica incorreta quando o comparativo incluir a
  brasileira Respondi.
- **v3** — foco em tráfego pago, comparativo nomeado vs Typeform, seção de Migração correta
  (aponta pro `/f/migracao`), depoimentos reais (texto verdadeiro, sem foto — todos com
  `photo: null`).
- **v4** — idêntica à v3, só em tema claro.

**Esta é uma decisão de produto/marca do Sidney, não uma decisão técnica** — ele vai abrir os
4 links e escolher com base em copy/design. O pedido ao Codex aqui é só de **avaliação de
prontidão técnica**, não de preferência estética.

### ✅ Parecer do Codex (2026-07-03) — promoção é esforço BAIXO
Promover qualquer versão a `/` exige só: (1) mover/adaptar a página escolhida para
`app/page.tsx`; (2) remover o `noindex`; (3) trocar os links do logo (`/v2`, `/v3` ou `/v4`)
por `/`; (4) revisar metadata global e OG. **O sitemap já aponta para `/` e o robots não exige
mudança; redirects NÃO são necessários.** Nenhuma versão tem risco técnico que as outras não
tenham (o extra da v2 são os itens de conteúdo listados acima). Sobre as versões
não-escolhidas: manter com `noindex` por um curto período é aceitável; depois da decisão,
remover do código ou isolar como preview interno — evita divergência e exposição de conteúdo
obsoleto.

---

## 3. 🟢 Decidido — completar o comparativo "Outras plataformas" com Yayforms e Respondi

### O achado
O pedido original do Sidney (vault, 20/05) foi comparar o EidosForm com **Typeform, Yayforms e
Respondi**. O que existe hoje em `v3`/`v4` compara **só com Typeform** (tabela de recursos +
comparação financeira), sem essa ampliação. **O Sidney já decidiu (03/07): completar com os
três.**

Há pesquisa de concorrência já registrada na memória do projeto
(`segundo-cerebro/projetos/eidosform.md`, seção "12. Concorrência — pesquisa 2026-05-20"), mas
o próprio vault avisa para **reconferir preços antes de publicar** (dados de maio podem estar
desatualizados).

### ✅ Parecer do Codex (2026-07-03) — localização corrigida + preços apurados
**Correção factual da REV 1:** NÃO existe `components/v3/comparison-section.tsx`. Os dados e a
renderização do comparativo estão **inline e duplicados** em `app/v3/page.tsx:140`
(`FINANCIAL_COMPARISON`) e `app/v4/page.tsx:137`. Antes de adicionar Yayforms e Respondi,
**extrair dados + tabela para um componente compartilhado** (mata a duplicação v3/v4). Em
mobile, 4 concorrentes numa grade fixa de 5 colunas fica ilegível — usar cards por concorrente
ou tabela com scroll horizontal.

**Preços oficiais apurados pelo Codex (03/07/2026 — reconferir na data da publicação):**
- **Yayforms** — anual: Starter R$29 (200 resp), Plus R$119 (2 mil), Professional
  aparentemente R$239 (20 mil); mensal: R$59 / R$179 / R$359. ⚠️ O último valor precisa ser
  confirmado direto na página no momento de publicar (a renderização alterna mensal/anual).
- **Respondi** — anual: Solo R$57 (1 mil), PRO R$147 (5 mil), Empresa R$237 (15 mil).
  ⚠️ A mesma página exibe também uma tabela antiga divergente (inclusive PRO R$87) — risco
  real de fonte inconsistente; citar só a tabela vigente.

**Regra de publicação:** registrar modalidade (mensal vs anual), data de consulta e URL de
cada preço — **sem misturar "mensal" com "por mês pago anualmente"** (vale também pro nosso
próprio preço exibido: o comparativo atual mostra Starter "R$29/mês", que é o equivalente
anual — manter a mesma modalidade em todas as colunas). Copy ao redor da tabela ("por que
somos melhores que X") precisa de ajuste ao virar 3-vias — redação final é decisão do Sidney.

---

## 4. 🟡 Fallback de cartão morto/expirado na troca de plano — caminho já desenhado, zero código

### O achado
`CLAUDE.md` (seção "PRÓXIMA FEATURE — decidida 2026-06-10") já registra a decisão de produto
do Sidney: quando o cartão salvo (`asaas_card_token`) está morto (expirado, recusado, cartão
virtual de 24h, ou cliente pré-tokenização sem token nenhum), hoje o fluxo falha fechado e manda
o cliente "falar com o suporte" — não existe tela de atualizar cartão. **Zero código
implementado** ainda.

**Solução já escolhida pelo Sidney (10/06):** abrir um checkout hospedado do Asaas cobrando
**só a diferença** como pagamento avulso (one-time, `chargeTypes: DETACHED`), capturar o cartão
novo por ali, e seguir o mesmo fluxo interno de sempre (sub recriada no preço cheio via token
novo + cancelamento da antiga, reusando `executePlanSwitch`/`runPlanChangeBackstop`).

**2 gates de confirmação que o próprio CLAUDE.md lista como pré-requisito, nunca fechados:**
1. O checkout hospedado **não persiste `externalReference`** (`lib/asaas.ts:172` retorna null)
   — o marcador `kind:planchange` se perde; precisa de outro fio para correlacionar o pagamento
   avulso com a troca de plano pendente.
2. Não está confirmado se um pagamento **avulso** (não-recorrente) no checkout hospedado
   devolve `creditCardToken` reutilizável — no fluxo recorrente devolve; no avulso é incerto.

### ✅ Parecer do Codex (2026-07-03)
1. **NÃO é bloqueador** para um lançamento controlado com zero clientes, desde que: (a) a
   falha continue fechada, sem cobrança indevida; (b) a mensagem de suporte seja clara pro
   cliente travado; (c) o gap seja monitorado e priorizado após o primeiro caso real.
2. **Gate decisivo = token no avulso:** o desenho depende INTEIRAMENTE de provar no sandbox
   que o checkout avulso entrega um `creditCardToken` reutilizável. **Se não entregar, a
   arquitetura proposta não funciona** — este smoke vem antes de qualquer código.
3. **Gate 1 (correlação) viável:** a linha de recuperação em `billing_checkouts` serve para
   correlacionar, mas deve guardar **identificador da sessão de checkout, tentativa, alvo
   (plano/ciclo) e estado** ANTES de abrir o checkout.
4. (Pendente de análise específica: revalidar o desenho de 10/06 contra o hardening de 15/06 —
   o parecer não contradisse nada, e a revisão de idempotência do §1 sugere que a base
   `executePlanSwitch`/backstop segue a mesma; confirmar no momento da implementação.)

---

## 5. 🟢 Itens de execução menores (baixo risco, sem decisão pendente) — pedido de revisão rápida

Para o Codex validar que as soluções propostas abaixo estão corretas antes de qualquer execução
(nenhuma foi implementada ainda):

1. Atualizar `CLAUDE.md` para refletir o estado pós-15/06 (hoje descreve o estado pré-hardening
   e conflita com a ficha de memória do projeto) — risco de alguém confiar no doc errado.
2. Confirmar que produção autentica webhooks só por access-token nativo do Asaas, e então
   remover o fallback `ASAAS_ALLOW_HMAC_FALLBACK` do código.
3. ~~`normalizeLooseUrl` nunca chamada; URLs salvas sem normalizar protocolo~~ **CORRIGIDO
   pelo Codex — o item da REV 1 estava factualmente errado:** as URLs principais JÁ são
   normalizadas por funções locais `ensureHttps` na criação (`app/api/forms/route.ts:14`) e na
   edição (`app/api/forms/[id]/route.ts:15`). A pendência real é **consolidar a duplicação**:
   fazer os dois pontos usarem `normalizeLooseUrl` (`lib/validators.ts:111`) e apagar as
   cópias locais. Higiene de código, não bug de produto.
4. Trocar o indicador "Salvo ✓" baseado em `setTimeout` de 2s
   (`components/form-builder/form-builder.tsx:540`) por um estado persistente ("Todas as
   alterações salvas").
5. Considerar validação opcional de Turnstile/hCaptcha por formulário
   (`app/api/responses/route.ts:40`) antes de escalar tráfego pago público — não bloqueia um
   lançamento controlado inicial.
6. OG image (`app/opengraph-image.tsx`) é genérica e compartilhada por v1/v3/v4 mesmo com
   posicionamentos diferentes — decisão de baixa prioridade do Sidney sobre se vale customizar
   por versão.

---

## 6. 🗺️ ORDEM DE EXECUÇÃO RECOMENDADA (Codex, 2026-07-03) — sequência segura

1. ~~Corrigir o briefing nos 4 pontos~~ ✅ FEITO (esta REV 2).
2. **Sandbox:** ensaiar estorno (Fase 0.1 do smoke), reativação via token (Fase 0.3) e o
   smoke do **token no checkout avulso** (gate decisivo do fallback de cartão morto).
3. **Sandbox:** acrescentar **fault injection** (ponto controlado de falha entre a confirmação
   do avulso e o `executePlanSwitch`) e provar que o backstop recupera a troca.
4. **Produção:** UM único ciclo real — compra → upgrade → downgrade → cancelamento → estorno
   (roteiro `docs/redesenho-upgrade-downgrade.md:63-90`, com o GATE P0-2 manual no painel).
5. **Só então declarar o billing liberado** (marcar os checkboxes de `docs/smoke-test-real.md`
   + atualizar `CLAUDE.md`).
6. **Promover a landing escolhida** e publicar o comparativo com preços datados
   (modalidade + data + URL de cada preço).

---

## 7. Contexto de apoio

- Repo: `/home/sidney/eidosform`, branch `main`, produção == `origin/main` (SHA `0448fd1`,
  confirmado via `git ls-remote`, sem commits pendentes de push).
- Domínio: `eidosform.com.br`. Nunca usar `*.vercel.app` como referência de URL (302 já quebrou
  webhook antes).
- `BILLING_MVP_ONLY` está OFF por padrão hoje (kill-switch, `lib/billing-launch-guard.ts:14`).
- Ficha de memória completa do projeto: `/home/sidney/segundo-cerebro/projetos/eidosform.md`
  (ler com ceticismo — tem trechos desatualizados, como o próprio documento admite na seção
  "CORREÇÃO DE STATUS 2026-06-29").
