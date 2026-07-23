# Briefing — Colunas de campos ocultos CONDICIONAIS no Google Sheets (v2 dos campos ocultos)

> **Status:** proposta para avaliação do Codex — NADA implementado.
> **Autor:** Sidney + Claude (pesquisa e desenho), 2026-07-09.
> **Briefing anterior (v1):** `docs/briefing-campos-ocultos-url.md` — este documento REVOGA a decisão do §"planilha nova" (linhas 52-53: trio `nome/email/telefone` sempre criado em B/C/D).

---

## 1. Problema

A v1 dos campos ocultos (deploy 07/07, commits `df0a0e4`+`83b73af`) criou o header do Sheets com as colunas `nome | email | telefone` **fixas em B/C/D para TODA planilha nova**, mesmo em forms que nunca recebem parâmetros na URL.

**Caso real que motivou a mudança:** o form "Perfil Alunos Formação" (`x7e9d32p`) não tem campos ocultos nem link com parâmetros, e a planilha conectada em 09/07 nasceu com B/C/D (`nome`, `email`, `telefone`) permanentemente vazias — colunas que confundem quem lê a planilha e não correspondem a nada do form. Ao mesmo tempo, outro form do mesmo dono usa os parâmetros de forma essencial. Ou seja: o comportamento precisa variar por form, e **sem configuração manual** se possível.

### Comportamento desejado (spec do dono do produto)

1. Form cujos links **nunca** carregam parâmetros → a planilha **não tem** colunas de campo oculto. Nenhuma.
2. Quando uma resposta chega **com** parâmetros válidos na URL, o EidosForm deve **identificar quais chaves vieram** e criar as colunas correspondentes na planilha **naquele momento** — não só o trio `nome/email/telefone`, mas as chaves que efetivamente chegaram (já sanitizadas pela `sanitizeUrlParams`, máx. 10).
3. Colunas criadas continuam preenchidas dali em diante; respostas sem parâmetros deixam as células vazias (como hoje).
4. Banco (`responses.url_params`), webhook e comportamento do player: **inalterados** — já capturam/entregam todas as chaves. A mudança é só na projeção para Sheets e CSV.

---

## 2. Comportamento atual (mapa de código)

| Ponto | Arquivo | O que faz hoje |
|---|---|---|
| Header na conexão | `lib/google-sheets.ts:137` (`connectSpreadsheet`) | Planilha vazia → escreve `Data/Hora, nome, email, telefone, response_id, status, <perguntas>, meta_events, utm_*`. Trio **incondicional**. |
| Header no 1º submit | `lib/google-sheets.ts:239-241` (`upsertSubmission`) | `existingHeaders.length === 0` → `presentIdentity = [...IDENTITY_COLUMNS]` (trio incondicional de novo). Planilha antiga → só usa o trio se os headers já existem (nunca insere). |
| Migração de header | `lib/google-sheets.ts:255-274` | Já existe mecanismo de **reescrita da linha 1** quando falta `response_id`/`status` ou surgem perguntas novas (`needsHeaderUpdate`). ⚠️ Reescreve a linha 1 **in place**, sem `insertDimension` — se a posição relativa muda, as linhas antigas NÃO acompanham. |
| Montagem da linha | `lib/google-sheets.ts:296-306` | Mapeia **por nome de header**, e a identidade já funciona **em qualquer posição** (`isIdentityHeader`, linha 237). Colisão com título de pergunta: a RESPOSTA vence (regra v1, manter). |
| Preenchimento | `lib/google-sheets.ts:300` | `urlParams?.[header] ?? ''` — mas SÓ para o trio (`IDENTITY_COLUMNS`). Chaves fora do trio nunca viram coluna (decisão v1 §54). |
| Sanitização | `lib/url-params.ts` | `sanitizeUrlParams`: minúsculas, `^[a-z0-9_-]{1,40}$`, valor 1..200, denylist de tracking + `utm_*`, máx. 10 chaves. **Compartilhada client/server** — é a fonte da verdade do que é "parâmetro válido". |
| CSV | `app/api/forms/[id]/export-csv/route.ts:129-140` e `export/route.ts:130-140` | Trio incondicional no header do CSV (`IDENTITY_KEYS`). |
| Chamadores | `app/api/responses/route.ts:635` e `app/api/responses/partial/route.ts:443` | Serverless (Vercel), **sem fila** — dois submits simultâneos = duas execuções concorrentes de `upsertSubmission`. |
| Update de linha | `google-sheets.ts:308-375` | Parcial→Completo com verify-before-write por `response_id` (fix 08/07) — busca a coluna do `response_id` **por nome a cada escrita**, então tolera mudança de posição de colunas. |

**Ponto-chave de viabilidade:** como a montagem da linha e o verify-before-write resolvem colunas **por nome de header a cada escrita**, adicionar/remover colunas entre uma escrita e outra NÃO quebra o mecanismo — o custo real está só em (a) alinhar as linhas ANTIGAS quando uma coluna nova entra no meio e (b) corrida entre escritas concorrentes.

---

## 3. Pesquisa — como o mercado resolve isso

- **Typeform** — hidden fields são **declarados no form** antes de conectar a integração; só então viram colunas na planilha. Campos criados DEPOIS da conexão exigem **reconectar** a integração (layout congela na conexão). Ou seja: colunas condicionais por **declaração explícita**, nunca por detecção. Fontes: [help center](https://www.typeform.com/help/a/google-sheets-for-typeform-360029256192/), [community — hidden fields not exported](https://community.typeform.com/your-typeform-results-32/hidden-fields-not-exported-to-google-sheets-9627).
- **Tally** — mesmo modelo: hidden fields são **blocos adicionados no builder** ([docs](https://tally.so/help/hidden-fields)); a integração mapeia colunas pela estrutura atual da planilha e tolera colunas movidas/apagadas ([docs da integração](https://tally.so/help/google-sheets-integration)). Campo oculto não disparado não aparece na linha.
- **Zapier/no-code (webhook → Sheets)** — criar coluna dinamicamente é tratado como **anti-pattern frágil**; a recomendação da comunidade é header pré-criado e estável ([thread 1](https://community.zapier.com/how-do-i-3/adding-a-new-column-header-in-google-sheet-webhook-google-sheet-3568), [thread 2](https://community.zapier.com/how-do-i-3/google-sheets-update-spreadsheet-row-s-with-dynamic-column-26471)).
- **API do Google Sheets** — inserir coluna no meio SEM desalinhar é suportado nativamente: `batchUpdate` + `InsertDimensionRequest` (dimension `COLUMNS`, `startIndex`) desloca **headers E todas as linhas de dados juntos**, mantendo o alinhamento; `inheritFromBefore` controla a formatação herdada. Para coluna no FIM, `AppendDimensionRequest`/reescrita da linha 1 basta. Fontes: [Row & column operations](https://developers.google.com/workspace/sheets/api/samples/rowcolumn), [batchUpdate guide](https://developers.google.com/workspace/sheets/api/guides/batchupdate).

**Leitura:** os dois líderes do mercado resolvem com **declaração** (form diz quais campos ocultos existem) e ninguém faz detecção automática — mas o motivo é que eles têm o conceito de "hidden field block" no builder, que o EidosForm não tem. A detecção automática é viável tecnicamente via `insertDimension`; o que ela exige é disciplina nos 4 riscos do §6.

---

## 4. Proposta — Opção B (detecção automática lazy) como principal

### Regra geral

> Colunas de campo oculto **nascem sob demanda**: a primeira resposta que chegar com uma chave de `url_params` que ainda não tem coluna na planilha dispara a criação da coluna. Form que nunca recebe parâmetros nunca ganha coluna.

### Mudanças por ponto

1. **`connectSpreadsheet` (`google-sheets.ts:137`)** — remover `...IDENTITY_COLUMNS` do header inicial. Header novo: `Data/Hora | response_id | status | <perguntas> | meta_events | utm_*`.
2. **`upsertSubmission` — criação incondicional (`:239-241`)** — remover o caso `existingHeaders.length === 0 → trio`. `presentIdentity` passa a ser calculado SÓ a partir do que já existe no header + do que a resposta atual traz (item 3).
3. **`upsertSubmission` — inserção lazy (novo passo entre 1 e 2)**:
   - `paramKeys = Object.keys(urlParams ?? {})` filtradas por: não é título de pergunta do form (`fieldLabels`), não é nome de coluna reservada (§6.2), ainda não existe no header.
   - Se sobrou chave nova → `batchUpdate` com `InsertDimensionRequest` (COLUMNS, `startIndex = 1`, ou seja, a partir de B, N colunas) + `values.update` de `B1..` com os nomes. **Inserir via `insertDimension`, NUNCA pela reescrita in-place da linha 1** — a reescrita desloca header sem deslocar as linhas antigas (ver §2, "Migração de header"); `insertDimension` desloca tudo junto e preserva o alinhamento das respostas já gravadas (células novas ficam vazias nas linhas antigas, correto).
   - Reler o header depois da inserção (o passo 2 atual já faz) e seguir o fluxo normal.
4. **Generalizar o preenchimento (`:300`)** — trocar `isIdentityHeader` (restrito ao trio) por `isParamHeader`: header que (a) está no conjunto de chaves possíveis de url_params (regex/sanitização de `lib/url-params.ts`), (b) não é título de pergunta deste form, (c) não é coluna reservada. Valor: `urlParams?.[header] ?? ''`. Colisão com pergunta: **resposta vence** (regra v1 mantida).
5. **CSV (`export-csv` e `export`)** — trocar o trio fixo pela **união das chaves de `url_params` presentes nas respostas do form** (já vêm no select). Nenhuma resposta com params → CSV sem colunas de campo oculto. Ordem: primeira aparição (ou alfabética — Codex decide, só ser consistente com o Sheets).
6. **Sheets do Google (integração) — posição das colunas novas:** a partir de B, na ordem de chegada. Chave nova posterior (ex.: form já tem `nome`,`email` e chega `telefone`) → insere DEPOIS do bloco de params existente (mantém Data/Hora em A e o bloco de identidade contíguo).

### O que NÃO muda

- `lib/url-params.ts` (sanitização, denylist, máx. 10 chaves, sessionStorage) — intacto.
- Banco `responses.url_params` e webhook — intactos (já são dinâmicos). **Zero migration.**
- Verify-before-write, lookup por `response_id`, `sheets_row_index` — intactos (mapeiam por nome, ver §2).
- Planilhas v1 que JÁ têm o trio: continuam funcionando (headers existentes seguem mapeados por nome). Nada é removido automaticamente.

---

## 5. Alternativas consideradas (para o Codex pesar)

- **Opção A — Declaração no builder (modelo Typeform/Tally):** campo nas configurações do form listando as chaves esperadas; colunas criadas na conexão só para forms com chaves declaradas. ✅ Determinístico, sem corrida, sem coluna-lixo. ❌ Passo manual (o dono pediu detecção automática), exige UI nova, e chave usada sem declarar não aparece no Sheets. **Pode ser combinada com a B depois** (declaração vira allowlist e a detecção cobre o resto).
- **Opção C — Colunas novas no FIM (depois das UTMs) em vez de B..:** dispensa `insertDimension` (só estende a linha 1), zero deslocamento, corrida mais benigna. ❌ Perde a ergonomia de leitura em B/C/D que motivou a v1. A montagem da linha já suporta identidade em qualquer posição, então é troca de 1 constante — decisão de produto, não técnica.
- **Opção D — manter como está + botão "ocultar colunas vazias":** rejeitada — não resolve o incômodo real (colunas existirem sem função) e não cobre chaves fora do trio.

---

## 6. Riscos e regras que o Codex precisa fechar

1. **Corrida na criação de coluna** — dois submits simultâneos com a mesma chave nova (ou chaves diferentes) podem inserir coluna duplicada/embaralhada, pois `/api/responses` e `/api/responses/partial` rodam concorrentes sem fila (§2). Mitigações possíveis: (a) reler o header logo após o `insertDimension` e, se detectar header duplicado, remover a duplicata (self-heal); (b) lock por planilha (advisory lock no Supabase em torno da seção de header); (c) aceitar e só logar (frequência baixíssima: exige 2 primeiras-respostas-com-chave-nova no mesmo segundo). **Codex escolhe.**
2. **Nomes reservados** — a sanitização atual bloqueia `utm_*` e tracking, mas NÃO bloqueia `?status=`, `?response_id=`, `?meta_events=`, `?data/hora=` (este último já cai pela regex). Um link `?status=vip` colidiria com a coluna de status. Regra proposta: denylist adicional de colunas reservadas **na projeção para Sheets/CSV** (a chave continua indo pro banco/webhook normalmente; só não vira coluna). Alternativa: bloquear já em `sanitizeUrlParams` (muda contrato do banco — evitar).
3. **Coluna-lixo por typo** — `?emial=x` cria coluna `emial` para sempre. Mitigação mínima: log claro na criação de cada coluna (`[sheets] coluna de campo oculto criada: <chave>`); a remoção manual pelo dono é segura (mapeamento por nome + verify-before-write). Mitigação forte: allowlist declarada (Opção A híbrida) — v2.1 se o problema aparecer na prática.
4. **Fórmulas do dono da planilha** — `insertDimension` desloca colunas; fórmulas DENTRO da planilha o Google ajusta sozinho, mas referências EXTERNAS por letra (`IMPORTRANGE`, Apps Script) quebram. Documentar no changelog/ajuda: "colunas de campo oculto entram em B quando o primeiro parâmetro chegar".
5. **Parcial→Completo cruzando a mudança** — parcial gravado sem colunas de param; antes do completo, outra resposta cria colunas; o completo reescreve a linha inteira pelo header novo → correto por construção (linha montada pelo header final). Cobrir com teste mesmo assim.
6. **Teto de colunas dinâmicas** — herdado da sanitização: máx. 10 chaves por resposta. Teto absoluto por planilha (ex.: 20 colunas de param acumuladas) para blindar contra links maliciosos variando chave — **Codex opina**.

---

## 7. Critérios de aceite

1. Form novo, sem parâmetros nos links → planilha conectada SEM `nome/email/telefone`; submits funcionam; CSV sem as colunas.
2. Mesmo form, primeira resposta com `?nome=X&telefone=Y` → colunas `nome` e `telefone` surgem em B/C preenchidas nesta linha; linhas antigas intactas e alinhadas (célula nova vazia).
3. Resposta seguinte sem parâmetros → células vazias, nada quebra (paridade com aceite v1 §85).
4. Chave nova depois (`?email=Z`) → coluna `email` entra após o bloco existente; linhas antigas alinhadas.
5. Parcial com params → Completo atualiza a MESMA linha (verify-before-write) com as colunas de param preenchidas, inclusive se as colunas nasceram entre o parcial e o completo.
6. `?status=vip` NÃO vira coluna nem contamina a coluna `status`; valor segue disponível em `responses.url_params`/webhook.
7. Pergunta intitulada "email" + `?email=x` → coluna única da pergunta, resposta vence (regra v1).
8. Planilha v1 (trio já existente): segue preenchendo normalmente; se o dono APAGAR as colunas vazias na mão, elas não renascem (a menos que chegue parâmetro).
9. Vitest: casos acima em teste de unidade do mapeamento de colunas + sanitização de coluna reservada; suite completa verde.

## 8. Fora de escopo

- UI de declaração de campos ocultos no builder (fica como evolução — Opção A híbrida).
- Remoção automática das colunas vazias em planilhas v1 já conectadas (dono remove na mão; é seguro).
- Mudanças em banco, webhook, player, sessionStorage.

## 9. Sequência de deploy

Sem migration. Deploy normal (push `main` → Vercel). Pós-deploy: apagar manualmente B/C/D da planilha do form Perfil Alunos (`x7e9d32p`) — operação segura (§6.3/aceite 8).
