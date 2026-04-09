## Handoff — Toin (Fix Responsividade ETAPA 1 Form Player) — 2026-04-09 16:40 GMT-3

### O que foi feito
- Corrigidos 9 bugs de responsividade identificados pela Zefa no Form Player
- Todos os fixes em um único commit `a7c7e5d`
- `npx tsc --noEmit` passou sem erros

### Bugs corrigidos

| Prioridade | Bug | Arquivo | Correção |
|---|---|---|---|
| P0 | NPS overflow horizontal em mobile | `question-renderer.tsx` | `w-8 h-8 sm:w-12 sm:h-12` + `justify-center` + `gap-1 sm:gap-2` |
| P1 | Calendly widget altura fixa 630px | `question-renderer.tsx` | `height: 'clamp(400px, 60vh, 630px)'` |
| P1 | Dropdown país overflow lateral | `question-renderer.tsx` | `right-0 sm:right-auto sm:left-0` + `max-w-[calc(100vw-2rem)]` |
| P1 | CEP w-40 frágil em mobile | `question-renderer.tsx` | `w-36 sm:w-40` |
| P2 | Número/Complemento sem empilhamento | `question-renderer.tsx` | `flex flex-col sm:flex-row` |
| P2 | Cidade/Estado sem empilhamento | `question-renderer.tsx` | `flex flex-col sm:flex-row` |
| P2 | Footer sem background | `form-player.tsx` | `bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm` |
| P3 | Progress label sem safe area | `form-player.tsx` | `top-[env(safe-area-inset-top,12px)]` |
| P3 | Opinion Scale assimétrico | `question-renderer.tsx` | `justify-center` + `w-9 h-9 sm:w-12 sm:h-12` |

### Arquivos alterados
- `components/form-player/question-renderer.tsx` — 9 linhas alteradas
- `components/form-player/form-player.tsx` — 2 linhas alteradas

### Validação
- `npx tsc --noEmit` ✅ (zero erros)

### Pendências
- Teste visual em dispositivos reais (iPhone notch, Android small screens)
- Verificar Calendly widget em viewports entre 400-630px
- Dark mode do footer precisa validação visual
