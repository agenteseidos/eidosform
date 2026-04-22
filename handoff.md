## Handoff — Toin — 2026-04-22 19:54 GMT-3

### Demanda
Corrigir Fase 2 do player do EidosForm — itens P2/P3 remanescentes da auditoria.

### O que foi feito
Todos os 10 itens corrigidos em um commit (`04fc5e2`).

| # | Item | Status | Detalhes |
|---|------|--------|----------|
| 1 | Footer cobrindo conteúdo no mobile | ✅ | `pb-28 sm:pb-24` + `pb-[max(1rem,env(safe-area-inset-bottom))]` |
| 2 | PixelInjector duplicado | ✅ | Removido da welcome screen; mantido apenas no render principal |
| 3 | Content block vazio vaza texto | ✅ | Removeu fallback "(Conteúdo não preenchido)" — renderiza `null` |
| 4 | Acessibilidade (aria/roles) | ✅ | `role=progressbar`, `role=navigation`, `role=form`, `aria-label` nos botões |
| 5 | Honeypot não ativado | ✅ | Campo `_hp_` hidden + validação no submit (rejeita se preenchido) |
| 6 | Progresso na welcome screen | ✅ | Barra e label ocultos quando `currentIndex === -1` |
| 7 | Array vazio no answeredCount | ✅ | Exclui arrays vazios `[]` da contagem de respondidas |
| 8 | Imagem welcome sem max-width | ✅ | Adicionado `max-w-full` |
| 9 | Dropdown país cortado em mobile | ✅ | Abre para cima (`bottom-full`), `max-h-50vh`, posicionamento corrigido |
| 10 | Redirect delay fixo 2.8s | ✅ | Configurável via `form.redirect_delay` (ms), default 2800 |

### Validação
- `tsc --noEmit` → limpo (exit code 0)
- Push para `main` → OK

### Arquivos alterados
- `components/form-player/form-player.tsx`
- `components/form-player/question-renderer.tsx`
- `lib/database.types.ts` (adicionado `redirect_delay` ao tipo Form)

### Próximo passo
Nenhum pendente da auditoria. Player limpo em P0/P1/P2/P3.
