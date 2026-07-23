# Briefing para auditoria (Codex) — Título do card de formulário cortado no dashboard

**Status:** PROPOSTA (ainda NÃO implementada). Auditar o plano antes de codar.
**Branch/commit base:** `main` (produção) — sem mudança aplicada ainda.
**Escopo:** 100% visual/CSS. Não toca dados, lógica, API nem banco.

---

## 1. Problema levantado (pelo Sidney)

No dashboard (`/dashboard`), os cards de formulário **cortam o título em uma linha** com
reticências: "Pesquisa de Perfil — Alu…", "Pesquisa — Raciocínio C…", "Briefing — Landing
Pag…". O Sidney quer o **nome completo do form visível**, podendo quebrar em 2, 3, 4 linhas.

**Causa (confirmada no código):** [`components/dashboard/form-card.tsx:93`], o título é um
`<Link>` com a classe **`truncate`** (Tailwind: `overflow:hidden; text-overflow:ellipsis;
white-space:nowrap`), que força uma linha só:

```tsx
<Link
  href={`/forms/${form.id}/edit`}
  title={form.title || 'Formulário sem título'}
  className="text-lg font-semibold text-slate-900 hover:text-blue-600 truncate block transition-colors"
>
  {form.title || 'Formulário sem título'}
</Link>
```

Contexto do layout:
- Container do título: `<div className="flex-1 min-w-0">` (permite encolher — ok).
- Card: `<Card className="overflow-hidden ...">`.
- Grid dos cards: [`components/dashboard/dashboard-shell.tsx:393`] →
  `<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">`.

---

## 2. Solução proposta

Trocar `truncate` por **`line-clamp-2`** (mostra até 2 linhas e só corta o excesso além
disso), **removendo o `block`** (ver ponto de atenção nº 1 abaixo):

```diff
- className="text-lg font-semibold text-slate-900 hover:text-blue-600 truncate block transition-colors"
+ className="text-lg font-semibold text-slate-900 hover:text-blue-600 line-clamp-2 transition-colors"
```

- Recomendação: `line-clamp-2` (ou `line-clamp-3` se houver títulos muito longos).
- **NÃO** remover o limite totalmente: um título gigante sem espaços poderia esticar um card
  desproporcionalmente. 2–3 linhas cobrem praticamente todos os títulos reais e protegem o
  caso extremo.

---

## 3. Efeito colateral analisado — altura dos cards

Único efeito real: cards com títulos de nº de linhas diferentes teriam alturas diferentes.
**Por que NÃO quebra o layout:** o container é CSS Grid, cujo padrão é `align-items: stretch`
→ **cards da mesma linha do grid igualam a altura pelo mais alto**. Resultado: cards lado a
lado ficam alinhados (o de título curto ganha só um pouco de respiro embaixo); linhas
diferentes do grid podem ter alturas diferentes (normal e aceitável).

---

## 4. Pontos de atenção para o Codex verificar

1. **Conflito de `display` entre `block` e `line-clamp-*` (o mais importante):**
   `truncate` e `line-clamp-2` funcionam com displays diferentes — `line-clamp-2` gera
   `display:-webkit-box`, enquanto `block` gera `display:block`. Se ambas ficarem na mesma
   classe, quem vence é a **ordem na folha compilada**, não a ordem no atributo. Por isso a
   proposta **remove o `block`**. Confirmar que: (a) sem `block`, o `line-clamp` aplica o
   `-webkit-box` corretamente e clampa; (b) o `<Link>` (um `<a>`, inline por padrão) se
   comporta como bloco via o `-webkit-box` do line-clamp (sem precisar de `block`).

2. **Tailwind v4 suporta `line-clamp-*` nativamente?** O projeto usa Tailwind CSS v4.
   `line-clamp` é utilitário core desde v3.3 e segue no v4 (sem plugin). Confirmar que não
   depende de `@tailwindcss/line-clamp` (plugin legado) nem de config extra.

3. **Palavra única muito longa (sem espaços):** pode transbordar horizontalmente. Avaliar se
   vale somar `break-words`. O `min-w-0` do container ajuda, mas confirmar.

4. **Tooltip redundante:** o atributo `title={form.title}` no `<Link>` vira redundante quando
   o texto aparece inteiro. É inofensivo (pode manter para o caso `line-clamp-3` ainda cortar
   títulos gigantes). Confirmar que não há problema de acessibilidade/duplicidade.

5. **Regressão visual em telas estreitas:** conferir no breakpoint `sm` (2 colunas) e mobile
   (1 coluna) que a quebra em 2 linhas não empurra/desalinha os metadados abaixo (data,
   `/f/slug`, badges) nem os botões "Editar/Respostas".

6. **Escopo:** confirmar que só o título precisa mudar. A linha do slug logo abaixo
   ([`form-card.tsx:100`], também `truncate`) deve **permanecer** em uma linha
   (slug não deve quebrar).

---

## 5. Esforço e risco
- **Esforço:** ~1 linha (troca de classe).
- **Risco:** baixíssimo — puramente presentacional, sem lógica/dados. Sem migration.
- **Verificação sugerida:** rodar no preview da Vercel e olhar o dashboard com títulos
  curtos e longos lado a lado; conferir nos 3 breakpoints (mobile / sm 2-col / xl 3-col).
