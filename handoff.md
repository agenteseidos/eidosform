## Handoff — Zéfa (auditoria embed) → Sidney — 2026-04-22 21:08 GMT-3

### Demanda
Auditar implementação de embed de formulários via iframe (commit `cf63994`), sem implementar correções.

### O que foi verificado

#### 1. ✅ Aba Compartilhar com código iframe configurável
- Campos de largura (number) e altura (number, px) presentes
- Código iframe gerado dinamicamente com `embedCode`
- Botão de copiar funcional com toast
- Gating por plano no builder: Plus/Professional vê a seção, Free/Starter vê upsell com link para `/billing`

#### 2. ✅ Detecção de iframe no player público
- `window.self !== window.top` com fallback `catch → true` (correcto para cross-origin)
- Tela de bloqueio com mensagem + link "Abrir formulário" em nova aba
- Prop `allowEmbed` passada do server component

#### 3. ✅ Gating por plano
- Server-side: `canEmbed = ownerPlan === 'plus' || ownerPlan === 'professional'` → prop `allowEmbed`
- Client-side: builder verifica `userPlan`, player verifica `allowEmbed`
- Regras corretas: Free/Starter bloqueado, Plus+ liberado

#### 4. ✅ CSP headers
- `/f/:slug` já tem `frame-ancestors *` (permite embed em qualquer site)
- Resto do app tem `frame-ancestors 'self'` (protegido)
- Nenhuma mudança necessária — já estava correto

#### 5. ✅ Responsividade do embed
- Iframe gerado com `width="100%"` por padrão e `max-width:100%;` inline
- `loading="lazy"` para performance
- Input de altura em px — adequado

### Bugs encontrados

#### P2 — Campo de largura aceita porcentagem no placeholder mas é type="number"
- `embedWidth` inicial é `"100%"` mas o input é `type="number"`, que **não aceita "%"**
- Resultado: campo começa vazio (number não parseia "100%"), usuário precisa digitar número puro (ex: 100)
- Se digitar 100, o iframe fica `width="100"` (sem %, = 100px) — quebra responsividade
- **Arquivo:** `components/form-builder/form-builder.tsx` linha ~1495
- **Impacto:** embed pode ficar 100px de largura se usuário não souber que deve digitar o valor correto

#### P2 — `isEmbedded` inicializa false, pode causar flash de conteúdo
- O state começa `false`, o `useEffect` roda após mount
- Em embeds rápidos, o formulário renderiza por 1 frame antes do bloqueio aparecer
- **Impacto:** leve flash visual, sem vazamento de dados funcional

#### P3 — Mensagem de bloqueio usa cor violeta (brand) ao invés de amarelo/amber
- Builder usa `amber` para upsell, player usa `violet` para bloqueio
- Inconsistência visual menor

### Resumo
- **P0:** 0 | **P1:** 0 | **P2:** 2 | **P3:** 1
- Implementação sólida, gating correto, CSP já estava preparado
- Bug mais relevante: tipo do input de largura (P2) — quebra responsividade do embed

### Arquivos auditados
- `app/f/[slug]/page.tsx`
- `components/form-builder/form-builder.tsx`
- `components/form-player/form-player.tsx`
- `next.config.ts`
- `middleware.ts`

### Pendências
- Corrigir input de largura: trocar `type="number"` por `type="text"` OU mudar default para `100` e injetar `%` no template do embedCode
- Opcional: inicializar `isEmbedded` com detecção síncrona para evitar flash

### Próximo passo
- Sidney decidir se corrige P2s agora ou deixa para depois
- Testar manualmente embed em site externo (plano Plus)
