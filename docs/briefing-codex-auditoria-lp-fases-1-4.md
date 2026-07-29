# Briefing para auditoria (Codex) — Auditoria LP, Fases 1–4 (commits `9e6c258`..`f45050b`)

**Data:** 2026-07-28
**Autor das mudanças:** Claude (sessão pelo app do celular)
**Revisor deste briefing:** Claude (sessão Claude Code na VPS) — revisou os diffs e verificou o estado ao vivo
**Estado:** tudo mergeado em `origin/main` (HEAD `f45050b`). **NADA em produção.**

---

## 1. Contexto

Uma sessão do Claude pelo app do celular auditou as landing pages (`/`, `/v2`, `/v3`, `/v4`)
contra o código real e executou 4 fases de correção, mais um fix de CI. O registro da auditoria
está em `docs/auditoria-lp-2026-07-28.md`.

Achados centrais da auditoria original:
- lista de planos **hardcoded em 6 lugares divergentes**;
- features vendidas que não chegavam ao cliente (alerta de 80% era função morta; abandono por
  pergunta tinha endpoint completo e **nenhuma tela** consumindo; "CSV avançada" do Professional
  não tinha lastro);
- vazamentos de gating (`redirect_url` sem gate nenhum; Sheets de parciais sem revalidar plano
  pós-downgrade; 4 dos 5 crons sem agendamento; UTM não chegando a webhook nem WhatsApp;
  `/register` sem `?cycle` dando 400 no checkout).

---

## 2. Estado real, verificado ao vivo (2026-07-28 21:45 BRT)

Não confie na ref local; foi tudo conferido:

| Fato | Como foi verificado |
|---|---|
| `origin/main` = `f45050b` | `git ls-remote` |
| **Nada disso está em produção** | `/v3` ao vivo não tem "O lead cai no seu WhatsApp", não tem "Meta CAPI", e **ainda tem "CSV avançada"** |
| Último deploy de produção = `0fc2299`, 15:24 BRT | `vercel ls` + `vercel inspect` |
| Push **não** dispara deploy | projeto Vercel tem `"sourceless": true` (repo associado, sem webhook de push) + existe deploy hook `manual-deploy` |
| Conta Vercel = **Hobby** | API `/v2/teams` → `billing plan: hobby` |
| Já existe timer de abandoned-leads na VPS | `eidosform-abandoned.timer`, ativo, a cada 15 min → `run-cron.sh abandoned-leads` |

⚠️ **Consequência prática:** `vercel --prod` a partir do clone local **sobe o diretório local**,
que está em `0fc2299` e com trabalho não commitado de outra frente. Não é o caminho. O caminho é
o **deploy hook** (builda a partir do GitHub, ref `main`).

---

## 3. O que foi entregue (5 commits, 35 arquivos, +1022/−609)

- **`9e6c258` Fase 1 — vazamentos de gating.** Gate 403 de `redirect_url` no PATCH; strip na
  criação; player anula `redirect_url` de dono Free; campo travado no builder com upsell.
  `syncToSheetsIfEnabled` passa a receber `ownerPlan` e revalidar `PLANS[].googleSheets` no envio
  de parciais. `checkResponseLimit` (morta) → `sendNearLimitAlert` com gate `planAtLeast(plan,'plus')`.
  Gate de API key passa a ler `PLANS[].apiAccess`. `/register` normaliza `cycle` legado.
  `vercel.json` ganha 4 crons.
- **`57c9139` Fase 2 — fonte única da vitrine (−492 linhas duplicadas).** Novo
  `lib/plan-marketing.ts` (preços e cotas **derivados** de `PLANS`) + `lib/plan-marketing.test.ts`
  com 23 asserts que **quebram o CI** se a vitrine prometer o que o runtime nega. 5 componentes
  passam a consumir `PLAN_MARKETING_LIST`.
- **`397c4ea` Fase 3 — última milha.** Novo `components/responses/analytics-panel.tsx` (abandono
  por pergunta + tempo médio), endpoint ganha `plan_gated`. UTM passa a viajar no payload do
  webhook (campo aditivo) e vira variáveis `{utm_*}` no template do WhatsApp.
- **`a25d900` Fase 4 — copy das `/v3` e `/v4`.** Seção nova de WhatsApp, bloco de tráfego 4→6
  cards, Mapa da Lógica, 20 tipos/11 templates, FAQ +2.
- **`f45050b` fix de CI** (pré-existente, não causado pela auditoria): guarda de hidratação
  `setState`-em-effect → `useSyncExternalStore` nos dois mobile-menus.

---

## 4. Feedback do revisor (o que ficou bom)

Registro honesto, porque muda o tipo de auditoria que faz sentido aqui:

1. **`lib/plan-marketing.test.ts` é a melhor parte da entrega.** Transformar "a página promete o
   que o produto entrega" num **teste que derruba o CI** ataca a causa-raiz, não o sintoma. É o
   tipo de coisa que impede o bug de voltar em seis meses.
2. **Os gates foram espelhados nas duas pontas** (escrita na API + leitura no player), que é o
   padrão certo — gate só de UI não é gate.
3. **Comentários com data e motivo** em cada mudança (`auditoria LP 2026-07-28`), o que torna o
   diff auditável sem precisar do autor.
4. Remover `checkResponseLimit` (morta) em vez de "consertar" código que ninguém chamava foi a
   decisão certa.

O que segue não invalida nada disso — são pontos que quero que você ataque adversarialmente.

---

## 5. Pontos de atenção para auditar

### A1. Gate de redirect no player contradiz a própria invariante da Fase 2
`app/f/[slug]/page.tsx`: `const ownerCanRedirect = ownerPlan !== 'free'` — **hardcoded**, enquanto
a API (`app/api/forms/[id]/route.ts`) usa `planConfig?.redirect`. A Fase 2 estabeleceu que a
verdade é `PLANS`. Se algum dia um plano tiver `redirect: false` sem ser o Free, as duas pontas
divergem em silêncio, e o player fica mais permissivo que a API. **Trocar por
`PLANS[ownerPlan]?.redirect`?**

### A2. Alerta de 80%: a flag de dedupe é queimada por quem não recebe o alerta
A RPC `check_and_increment_response` marca `limit_alert_sent` **independente do plano**;
`sendNearLimitAlert` só envia e-mail para Plus+. Ou seja: usuário Free/Starter cruza os 80%, a
flag é consumida, nenhum e-mail sai. Se ele **fizer upgrade no mesmo ciclo**, a flag já está
queimada e ele não recebe o alerta que acabou de comprar. **Quando `limit_alert_sent` é
resetada?** (há resets em ativação/expiração de plano — confirmar se cobrem upgrade e virada de
mês). Se não cobrir, o alerta Plus+ nasce com um buraco.

### A3. Analytics avançado é gateado pelo flag `partialResponses`
`app/api/forms/[id]/analytics/route.ts` usa `planConfig?.partialResponses` como proxy de
"analytics avançado" (abandono + tempo médio). São duas features distintas amarradas num flag só:
mexer em `partialResponses` move a analytics junto, sem ninguém perceber. **É intencional? A
vitrine promete as duas no mesmo plano?**

### A4. Cota do Free: a vitrine promete 100, o banco grava 50, o enforcement usa 100
Achado desta sessão, e a Fase 2 **aumentou** a exposição dele:
- `lib/plan-marketing.ts` deriva `responsesLabel` de `PLANS.free.maxResponses` = **100** → a LP
  promete 100;
- o trigger `handle_new_user()` **vivo em produção** grava `responses_limit = 50` (conferido via
  `pg_get_functiondef`; o arquivo `20260424_...sql` no repo diz 100 — o repo está desatualizado);
- o **enforcement real** ignora a coluna quando o plano é free: `lib/plan-limits.ts:47` usa
  `PLANS.free.maxResponses` = **100**;
- a **exibição** usa a coluna: `app/api/user/plan-features/route.ts:142` →
  `profile?.responses_limit ?? PLANS.free.maxResponses`.

Resultado: **conta free nova vê "/50" no painel enquanto a LP promete 100 e o sistema deixa passar
100.** Qual é a verdade pretendida? Duas saídas: (a) o trigger passa a gravar 100; (b) a exibição
do free passa a ler `PLANS`, como o enforcement já faz. **Não foi tocado** — precisa de decisão do
Sidney.

### A5. Forms EXISTENTES de dono Free param de redirecionar
O gate do player não é só para forms novos: form publicado de dono Free **perde o redirect** no
deploy. É o efeito desejado (é a pressão de migração), mas é perda de função em produção sem
aviso ao dono. Mesmo padrão já aplicado ao Calendly. **Confirmar que não há erro de runtime e
decidir se cabe avisar os afetados** (dá para levantar quantos são: forms com `redirect_url` não
nulo cujo dono é free).

### A6. Crons: duplicidade real + incompatibilidade com o plano (BLOQUEIA O DEPLOY)
`vercel.json` agenda 5 crons, 4 sub-diários — incluindo `*/15 * * * * /api/cron/abandoned-leads`.
Só que **a VPS já roda `eidosform-abandoned.timer` a cada 15 minutos**, chamando o mesmo endpoint.
Se ambos rodassem, o alerta de lead abandonado sairia **em dobro para leads reais** — dano
visível ao cliente final. E a conta é **Hobby** (máximo 2 crons, só diários), então o deploy é
**recusado** de qualquer forma. O briefing de handoff afirmava que não havia timer de
abandoned-leads na VPS; **essa afirmação está errada** — o timer existe e está ativo.

### A7. 3 testes falhando
`npx vitest run` → 649/652. As 3 falhas são de `services/whatsapp/` e são pré-existentes
(dependem do ambiente da VPS). **Confirmar que continuam pré-existentes** (`git stash` + rodar na
base) e que não estão mascarando regressão introduzida pelas fases.

### A8. UTM no payload do webhook
Campo aditivo `utm` em `lib/webhook-dispatcher.ts`. **Algum consumidor valida schema estrito** e
quebraria com chave nova? E o `{utm_*}` no template do WhatsApp: o que acontece quando a variável
não tem valor (lead sem UTM) — sobra placeholder cru na mensagem?

### A9. A página indexada continua desatualizada (coerência pós-deploy)
`/v3` e `/v4` são `noindex` (teste A/B). A **raiz é a página que o Google vê** e ela **não**
recebeu a copy da Fase 4 — só a vitrine de preços nova (componente compartilhado). Depois do
deploy a raiz fica com **vitrine corrigida + copy antiga**. Verificar que isso não gera
contradição na mesma página (ex.: corpo do texto citando feature que a tabela de preços agora
posiciona em outro plano). Verifiquei ao vivo que a raiz hoje ainda exibe "CSV avançada" — some
com o deploy, mas o resto do corpo não foi revisado.

### A10. Deploy não é automático — e o repo não documenta isso
O projeto tem `sourceless: true`. Um `git push` na `main` **não** sobe nada. Existe um deploy hook
`manual-deploy`. O `DEPLOY.md` e a memória operacional precisam refletir isso (a memória dizia o
contrário e induziu a erro). **Recomendação: conectar o Git de verdade na Vercel** e a categoria
inteira de problema desaparece.

---

## 6. O bloqueio do deploy e o que eu recomendo

**O deploy não pode sair como está** (A6). Três saídas:

- **(A) — recomendada.** Remover os 5 crons do `vercel.json` e agendar por **timers systemd na
  VPS**, que é o padrão que o projeto **já usa** (`eidosform-abandoned`, `eidosform-wpp-hc`) e o
  que a memória operacional registra ("crons de billing são por crontab da VPS, não Vercel").
  Custo zero, sem duplicidade, deploy sai hoje, e os 3 crons de billing que hoje **não têm
  agendador nenhum** passam a ter.
- **(B)** Upgrade para Vercel Pro. Resolve o limite, **mas não resolve a duplicidade** — o cron de
  abandoned-leads tem que sair de um dos dois lados de qualquer jeito.
- **(C)** Subir só as Fases 1–4 sem crons e deixar o agendamento para depois. Entrega valor hoje,
  mantém a lacuna dos reconciles de billing.

Rebaixar as cadências para diárias **não** resolve sozinho: Hobby limita a 2 crons por projeto, e
são 5.

**Pergunta ao Codex:** vê algum motivo técnico para preferir cron da Vercel a timer na VPS neste
caso? O contra-argumento óbvio a favor da Vercel é não depender da VPS estar de pé — mas o alerta
de lead abandonado, que é o mais sensível ao tempo, **já** depende dela hoje.

---

## 7. Frente paralela, não commitada (não faz parte destes commits)

Na mesma árvore de trabalho há uma feature separada, **não commitada**: telefone (WhatsApp)
obrigatório no cadastro, alimentando `profiles.phone` via metadata + trigger. Briefing próprio em
`docs/briefing-telefone-no-cadastro.md`. **A migração de banco já foi aplicada em produção**
(confirmado pelo comentário em `profiles.phone`), mas **o código ainda não subiu**.

⚠️ Dois avisos:
1. `app/(auth)/register/page.tsx` foi tocado **pelas duas frentes** (a Fase 1 mexeu no `cycleParam`,
   a frente do telefone mexeu logo abaixo) — vai dar **conflito de merge** ao rebasear. É trivial,
   mas não pode ser resolvido no automático sem olhar.
2. Enquanto o código do telefone não sobe, o trigger novo simplesmente grava `NULL` — inofensivo.

---

## 8. O que eu quero de você, Codex

1. **Contesta os pontos A1–A10.** Quero especialmente que você tente **derrubar** A2 (a flag de
   dedupe) e A4 (a cota do Free) — se eu estiver errado nesses dois, o conserto muda.
2. **Procura o que eu não vi.** Revisão foi por leitura de diff, não por execução. Em particular:
   `syncToSheetsIfEnabled` com `ownerPlan` atravessando `updateCtx` (a mudança mais invasiva da
   Fase 1) e o `useSyncExternalStore` do `f45050b` (guarda de hidratação — SSR/CSR divergindo?).
3. **Opina sobre a decisão de crons** (seção 6) com argumento técnico, não preferência.
4. Se achares que alguma das 4 fases **não deveria subir junto** com as outras, diz qual e por quê
   — dá para fatiar o deploy por commit.
