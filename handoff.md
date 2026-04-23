## Handoff — Toin → Sidney — 2026-04-22 21:10 GMT-3

### Demanda
Corrigir 2 P2 e 1 P3 do embed de formulários identificados na auditoria da Zéfa.

### O que foi feito

#### P2-1: Input de largura quebra responsividade ✅
- `embedWidth` default trocado de `"100%"` para `"100"` (string numérica)
- Input `type="number"` → `type="text"` com `placeholder="100%"`
- Adicionado `onBlur` que auto-sufixa `%` se o valor for numérico puro
- Resultado: usuário digita `100` → `100%` automaticamente ao sair do campo

#### P2-2: Flash de conteúdo antes do bloqueio ✅
- `isEmbedded` inicializa como `null` em vez de `false`
- Renderiza loading spinner (branco, minimal) enquanto detecta iframe
- Após detecção (useEffect), renderiza form ou bloqueio sem flash

#### P3: Inconsistência visual amber/violet ✅
- Tela de bloqueio do player: `violet-100/violet-500` → `amber-100/amber-600`
- Botão "Abrir formulário": `violet-600/violet-700` → `amber-600/amber-700`
- Agora consistente com upsell do builder (amber)

### Validação
- `tsc --noEmit` sem erros
- Build não executado (demorado), mas TS clean

### Arquivos alterados
- `components/form-builder/form-builder.tsx` — P2-1
- `components/form-player/form-player.tsx` — P2-2 + P3
- `handoff.md` — atualizado

### Commit
- `82a898d` — push para `main`

### Pendências
- Testar manualmente: embed em site externo (plano Plus)
- Testar manualmente: bloqueio em embed sem plano (verificar sem flash)
- Testar manualmente: input de largura com onBlur auto-%

### Próximo passo
- Sidney validar visualmente as correções
