# Briefing para auditoria (Codex) — Telefone (WhatsApp) obrigatório no cadastro

**Branch:** `main` (working tree, NÃO commitado, NÃO deployado)
**Data:** 2026-07-28
**Autor da mudança:** Claude
**Tipo:** captura de dado no funil de cadastro + persistência no perfil da conta (toca schema)

> ⚠️ **Atenção ao auditar o working tree:** há mudanças NÃO relacionadas e não commitadas
> em `app/v3/page.tsx`, `app/v4/page.tsx`, `components/v3/*`, `components/v4/*` (ajuste de
> espaçamento mobile das landings), feitas por OUTRA sessão em paralelo. **Não fazem parte
> desta entrega.** O escopo desta auditoria são só os 6 arquivos da seção 3.

---

## 1. Objetivo / decisão de negócio

O cadastro do EidosForm (`/register`) coletava **nome, e-mail e senha**. Passa a coletar
também **telefone (WhatsApp)**, na ordem pedida: **Nome → Telefone (WhatsApp) → E-mail →
Senha → Confirmar senha**.

O telefone precisa **abastecer o perfil da conta pelo mesmo caminho que o nome já abastece**
— ou seja, ir parar em `public.profiles`, não ficar só no formulário. Isso destrava três
coisas que hoje dependem de o usuário preencher telefone só na hora do checkout:

1. **Identidade de follow-up (Elen):** `profiles.phone_match_key_br` é coluna **GERADA** a
   partir de `profiles.phone` (migração `20260724_followup_phone_identity`). Gravando o
   telefone no cadastro, a chave de match nasce junto com a conta.
2. **Checkout:** `phone` é campo **obrigatório** de cobrança (`REQUIRED_BILLING_FIELDS` em
   `lib/billing-profile.ts`) e vai para o Asaas como `phone`/`mobilePhone`. Quem se cadastra
   agora já chega no checkout com esse campo preenchido — um atrito a menos na venda.
3. **Lista com opt-in** (o gargalo conhecido da campanha de WhatsApp): esta entrega resolve a
   **coleta do telefone**. O **opt-in NÃO foi implementado** — ver seção 7.

---

## 2. Desenho escolhido (e o porquê)

### 2.1 O telefone viaja pelo mesmo trilho do nome
O nome sempre chegou no perfil assim: `signUp(options.data.full_name)` → grava em
`auth.users.raw_user_meta_data` → o trigger `on_auth_user_created` /
`public.handle_new_user()` copia para `public.profiles`. O telefone usa **exatamente esse
trilho** (`options.data.phone`), com o trigger atualizado para ler mais essa chave.

Não foi criado um segundo caminho de escrita (ex.: update com service-role dentro da rota de
signup). Um caminho só = menos superfície de divergência.

⚠️ **`raw_user_meta_data->>'phone'` NÃO é `auth.users.phone`.** A coluna nativa `auth.users.phone`
é do login/OTP por SMS do Supabase e **não foi tocada**.

### 2.2 Formato de armazenamento: dígitos com DDI
A rota normaliza com `toWhatsAppDigits()` antes de persistir. `(83) 99937-6704` vira
`5583999376704`.

Motivo: **10/11 dígitos é número brasileiro sem DDI** — é a regra P2-3 já documentada em
`lib/phone.ts` e usada pelo envio e pelo `wa.me`. Guardar o texto mascarado deixaria o DDI
implícito e cada consumidor teria que readivinhar. Guardando canônico:
- `phone_match_key_br` (coluna gerada) resolve certo;
- `lib/billing-profile.ts` já faz `digitsOnly()` antes de mandar pro Asaas — indiferente;
- `toWhatsAppDigits()` no envio devolve o mesmo valor (12–15 dígitos passam intactos).

### 2.3 Máscara de digitação com escape hatch internacional
`formatPhoneBRInput()` (novo, em `lib/phone.ts`) aplica a máscara BR enquanto o usuário
digita. **Se o valor começa com `+`, a máscara NÃO é aplicada** — só `+` e dígitos. Sem isso,
`+351912345678` viraria `(35) 1912-3456`, um número brasileiro que não existe: a máscara
*mentiria* sobre o dado.

### 2.4 Validação: a regra única da stack
Front e back usam **a mesma função**, `isValidWhatsAppPhone()` (10 a 15 dígitos), a mesma que
o painel/PUT/envio de notificação usam desde a 2ª auditoria (P2-2). Nenhuma faixa nova foi
inventada.

---

## 3. Arquivos alterados (6)

- **`lib/phone.ts`** — nova `formatPhoneBRInput(raw)`. Só formata: não valida e não decide DDI.
- **`lib/phone.test.ts`** — 6 casos novos para a máscara (progressão, idempotência, teto de 11
  dígitos, escape `+`, teto E.164, e round-trip com `isValidWhatsAppPhone`/`toWhatsAppDigits`).
- **`app/(auth)/register/page.tsx`** — campo `Telefone (WhatsApp)` entre Nome e E-mail;
  `type=tel`, `inputMode=tel`, `autoComplete=tel`; máscara no `onChange`; validação client-side;
  microcopy *"Usamos para falar com você sobre a sua conta."*; `phone` no corpo do POST.
- **`app/api/auth/signup/route.ts`** — `phone` obrigatório; rejeita inválido com **400**
  *antes* de consumir rate limit; normaliza com `toWhatsAppDigits`; envia em
  `options.data.phone`.
- **`app/api/auth/signup/route.test.ts`** *(novo)* — 9 casos: obrigatoriedade, faixa, ordem
  validação×rate-limit, normalização (BR sem DDI / com +55 / internacional), e a garantia de
  que a resposta anti-enumeração de e-mail duplicado continua 201 genérica.
- **`supabase/migrations/20260728_signup_phone_to_profile.sql`** *(novo)* — `handle_new_user()`
  passa a gravar `phone`; **+ backfill** dos perfis com `phone IS NULL` a partir do metadata.

**Nenhum arquivo de billing, de notificação ou de settings foi tocado.**

---

## 4. Invariantes que DEVEM permanecer verdadeiras

1. **Um caminho de escrita só** para o telefone no cadastro: metadata → trigger → `profiles.phone`.
2. `profiles.phone_match_key_br` continua **GERADA** — ninguém escreve nela (a migração não escreve).
3. Front e back concordam na validação: os dois chamam `isValidWhatsAppPhone` (10..15 dígitos).
4. O valor persistido é sempre `toWhatsAppDigits()` — dígitos, com DDI, sem máscara.
5. **Anti-enumeração de e-mail preservada:** e-mail já cadastrado continua devolvendo 201 genérico.
6. O **rate limit não é consumido** por payload inválido (a validação de telefone vem antes).
7. `auth.users.phone` (SMS/OTP nativo do Supabase) permanece intocada.
8. A migração é **aditiva e idempotente**: rodar 2× não muda o resultado; o backfill só preenche
   nulos e **nunca sobrescreve** telefone editado pelo usuário.
9. Login, recuperação de senha e OAuth Google **não** passam a exigir telefone.

---

## 5. Riscos e perguntas adversariais para o Codex

### Ordem de deploy / schema
- **P1.** O deploy é `git push` → Vercel. **A migração é SQL manual.** Se o código subir antes
  do SQL, o telefone dos cadastros nesse intervalo fica só em `raw_user_meta_data` e
  `profiles.phone` fica NULL — falha **silenciosa**. Foi por isso que a migração inclui
  backfill (`UPDATE ... WHERE p.phone IS NULL`). **Confirmar que o backfill realmente recupera
  esses casos** e que rodar a migração depois do deploy é seguro. Ainda assim: **rodar o SQL
  primeiro é o certo.**
- **P2. ✅ RESOLVIDO em 2026-07-28** — conferido no banco de produção com
  `pg_get_functiondef`. A função viva é a variante de
  `20260424_auto_create_profile_on_signup.sql` (`ON CONFLICT (id) DO NOTHING`, com
  `plan/responses_limit/responses_used`, `SET search_path TO ''`), **não** a de
  `schema_eidosform.sql`. Não há `avatar_url` nem `DO UPDATE` para regredir. Trigger:
  um único `on_auth_user_created`, `tgenabled = 'O'`.
  ⚠️ **Mas a verificação revelou uma DIVERGÊNCIA:** a função viva grava
  `responses_limit = 50`; o arquivo versionado no repo diz `100`. **A migração foi ajustada
  para 50**, preservando o comportamento real — ver P17.
- **P3. ✅ RESOLVIDO** — ACL viva:
  `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`.
  `CREATE OR REPLACE FUNCTION` **preserva** dono e permissões (não recria o objeto), então os
  grants não mudam. Confirmar rodando a mesma query depois de aplicar. Observação lateral:
  `anon`/`authenticated` têm EXECUTE (default do Supabase, apesar do REVOKE FROM PUBLIC de
  `20260430`), mas chamar uma função de trigger fora de contexto de trigger é erro no Postgres
  — risco baixo, e **pré-existente**.
- **P4.** A função roda com `SET search_path = ''`. Todas as referências dentro dela estão
  schema-qualificadas (`public.profiles`)? Conferir que nada ficou sem qualificar.
- **P17. Divergência de cota do Free (PRÉ-EXISTENTE, não introduzida aqui).** A função viva
  grava `responses_limit = 50` em toda conta nova. Só que:
  - o **enforcement real** ignora a coluna quando o plano é free —
    `lib/plan-limits.ts:47` usa `PLANS.free.maxResponses` = **100**;
  - a **exibição** usa a coluna — `app/api/user/plan-features/route.ts:142` faz
    `profile?.responses_limit ?? PLANS.free.maxResponses`.

  Ou seja: hoje, conta free nova mostra **/50** na UI mas aceita até **100** respostas. A
  migração **mantém 50** de propósito (não muda produto de carona). Confirmar o diagnóstico e
  decidir o conserto separado: subir a coluna para 100 no trigger, ou fazer a exibição do free
  ler `PLANS` como o enforcement já faz.
- **P5.** `profiles.phone` tem alguma constraint/índice único? (Não deveria — duas contas podem
  compartilhar telefone, ex.: casal/sócios.) Se houver, o cadastro passa a falhar por duplicidade.

### Dado e normalização
- **P6.** **Número de 10/11 dígitos ganha `55` automaticamente.** Um estrangeiro que digitar o
  número local sem `+` vira um telefone brasileiro errado. É a regra P2-3 já existente e o
  produto é pt-BR, mas: a microcopy/placeholder deixa claro o suficiente que estrangeiro precisa
  digitar `+DDI`?
- **P7.** **Divergência de formato entre contas antigas e novas:** contas antigas têm em
  `profiles.phone` o texto mascarado que o usuário digitou no billing (`(11) 99999-9999`);
  contas novas terão dígitos (`5511999999999`). Algum consumidor faz comparação/`ilike`/join por
  string crua de `profiles.phone`, em vez de por `phone_match_key_br` ou `digitsOnly`? (Buscar:
  export, webhooks, `lib/identity-match.ts`, crons, `lib/whatsapp.ts`, painel admin.)
- **P8.** **Cosmético conhecido, NÃO corrigido:** em Configurações → *Dados de cobrança*, o campo
  Telefone vai exibir `5583999376704` em vez de mascarado. Salvar por cima é inofensivo (13
  dígitos passam na validação e a chave gerada sai igual). ⚠️ **Armadilha se alguém for
  "arrumar":** aplicar `formatPhoneBRInput` no valor salvo produz `(55) 83999-3767` — errado.
  Um formatador de EXIBIÇÃO teria que tratar o prefixo 55 explicitamente. Vale corrigir?
- **P9.** O trigger usa `ON CONFLICT (id) DO NOTHING`. Se o usuário se cadastrar, **não
  confirmar o e-mail** e se cadastrar de novo com outro telefone, o `auth.users` já existe → não
  há novo INSERT → **o telefone novo não é gravado** (nem no metadata, que o Supabase também não
  atualiza no resend). Confirmar o comportamento real e se é aceitável.
- **P10.** `phone` é lido de JSON não tipado. `isValidWhatsAppPhone`/`toWhatsAppDigits` aceitam
  `unknown` e fazem `String(...)`. Payload hostil (`{phone: {}}`, `{phone: []}`, `{phone: 123}`,
  `{phone: null}`) cai em 400 limpo em todos os casos? (`[]` → `String([])` = `''` → falsy → 400;
  `[83999376704]` → `String` = `'83999376704'` → **passa**. É aceitável?)

### Front / conversão
- **P11.** **Atrito no cadastro.** Um campo obrigatório a mais no topo do funil derruba
  conversão. Foi feito obrigatório para espelhar nome/e-mail — mas é uma decisão de negócio
  reversível (ver seção 7).
- **P12.** A máscara reformata a cada tecla. **Cursor no meio do texto:** editar o meio do
  número joga o cursor pro fim (comportamento padrão de máscara controlada em React). Aceitável?
- **P13.** Autofill do navegador/gerenciador de senha preenche o campo `tel` com um valor que a
  máscara mutila? (`autoComplete="tel"` normalmente entrega `+55...` → cai no escape hatch `+`.)
- **P14.** `formatPhoneBRInput` corta em 11 dígitos no modo local. Colar `+55 11 99999-9999`
  **sem** o `+` (`5511999999999`, 13 dígitos) vira `(55) 11999-9999` — errado, e o usuário pode
  não perceber porque passa na validação. Mitigação possível: detectar prefixo `55` + 12/13
  dígitos e tratar como internacional. **Vale a pena?**

### Cobertura
- **P15.** **Cadastro via Google OAuth não coleta telefone** — essas contas seguem com
  `phone = NULL` até o checkout. É o buraco de cobertura conhecido (ver seção 7).
- **P16.** Existe alguma outra porta de criação de conta (convite, admin, API, seed) que
  precisaria do telefone? (Busca feita: só `/api/auth/signup` chama `auth.signUp`.)

---

## 6. Estado dos testes

- `npx vitest run` (suíte inteira): **668/668 passando, 51 arquivos**.
- `npx tsc --noEmit`: **0 erros**.
- `npx eslint` nos arquivos alterados: **limpo**.
- **NÃO** rodado: `npm run build` completo (histórico de OOM na fase TypeScript — rodar com
  `NODE_OPTIONS=--max-old-space-size=3072` antes do deploy).
- **NÃO** testado ponta a ponta contra o Supabase real: **o caminho metadata → trigger →
  `profiles.phone` ainda não foi verificado com um cadastro de verdade.** É o smoke obrigatório
  antes de considerar a entrega pronta (seção 8).
- **NÃO** commitado, **NÃO** deployado, migração **NÃO** aplicada.

---

## 7. O que ficou de fora, de propósito

1. **Opt-in de WhatsApp.** O caminho aprovado em 27/07 era *"telefone + opt-in no cadastro"*.
   Só o **telefone** foi implementado. Sem checkbox de opt-in, esta base **não autoriza disparo
   de campanha MARKETING** — serve para atendimento/relacionamento e para o cadastro do Asaas.
   Precisa de decisão: texto do consentimento, coluna nova em `profiles` (com data e origem) e
   posição na tela.
2. **Telefone no card "Perfil" de Configurações.** Hoje o telefone aparece e é editável em
   *Dados de cobrança*, logo abaixo. Colocá-lo TAMBÉM no card Perfil criaria **dois editores da
   mesma coluna na mesma página**: salvar no Perfil e depois salvar Cobrança (com o valor antigo
   ainda no estado do outro card) **reverteria** a alteração em silêncio. Fazer direito exige
   unificar o campo — mudança maior, fora do escopo pedido.
3. **Coleta de telefone pós-OAuth Google.** Exigiria um passo de onboarding depois do primeiro
   login. É uma feature, não um ajuste de formulário.
4. **Cota do Free: 50 (coluna) × 100 (enforcement e vitrine).** Achado durante a verificação da
   função viva — ver **P17**. Não foi tocado aqui de propósito; precisa de decisão sua.

---

## 8. Passos de validação recomendados (nesta ordem)

1. ~~Confirmar no banco a definição VIVA de `public.handle_new_user()` e os grants~~ — **FEITO em
   2026-07-28**, ver P2/P3. A migração já foi ajustada ao que está vivo (`responses_limit = 50`).
2. Aplicar `supabase/migrations/20260728_signup_phone_to_profile.sql` no SQL Editor.
3. Deploy do código.
4. Smoke real: cadastrar uma conta de teste com telefone → conferir em `profiles` que `phone`
   está em dígitos com DDI **e** que `phone_match_key_br` foi calculada.
5. Abrir Configurações → *Dados de cobrança* e confirmar que o telefone aparece preenchido.
6. Iniciar um checkout com essa conta e confirmar que o campo Telefone já vem preenchido (não
   deve mais abrir o dialog pedindo telefone).
7. Limpar a conta de teste.
