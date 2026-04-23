## Handoff — Toin (embed de formulários) — 2026-04-22 21:01 GMT-3

### Demanda
Implementar feature de embed de formulários via iframe, com gating por plano.

### O que foi feito
1. **Aba Compartilhar (builder)** — adicionada seção de embed com:
   - Campos de largura e altura configuráveis
   - Código iframe gerado dinamicamente para copiar
   - Gating: só aparece se plano for Plus ou Professional
   - Upsell com link para /billing para Free/Starter

2. **Player público (/f/[slug])** — detecção de iframe:
   - Detecta `window.self !== window.top` para identificar embed
   - Se plano do dono NÃO for Plus/Professional → mostra mensagem de bloqueio com link para abrir em nova aba
   - Se plano for Plus/Professional → renderiza normalmente (sem branding via hide_branding já existente)

3. **Headers CSP** — já existiam `frame-ancestors *` para `/f/:slug`, sem mudança necessária

### Regras implementadas
- Free/Starter: sem embed (bloqueado no player + upsell no builder)
- Plus: embed permitido, sem marca
- Professional: embed permitido, sem marca + white-label

### Arquivos alterados
- `components/form-builder/form-builder.tsx` — seção embed na aba Compartilhar + state embedWidth/embedHeight + embedCode
- `components/form-player/form-player.tsx` — prop allowEmbed + detecção iframe + tela de bloqueio
- `app/f/[slug]/page.tsx` — pass allowEmbed=true se plano for Plus/Professional

### Resultado
- TypeScript compila sem erros
- Commit: `cf63994` — pushado na main
- Build falha por erro pré-existente (supabaseUrl missing), não relacionado

### Pendências
- Nenhuma bloqueante
- Não foi necessária migration SQL (feature usa apenas plano já existente)

### Próximo passo
- Sidney revisar
- Testar manualmente: embed de um form Plus em site externo
- Testar: embed de form Free deve ser bloqueado
