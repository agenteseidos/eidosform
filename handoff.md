# Handoff — Zéfa — 2026-04-04 20:12 GMT-3

## O que foi feito

✅ **ETAPA 7: Performance & Code Quality — AUDITORIA COMPLETA**

Auditados todos os 6 pontos:
1. ✅ Imports desnecessários (Tree-shaking) — OK, nenhum encontrado
2. ⚠️ Re-renders desnecessários — 25+ componentes sem memo, P2 CRÍTICO em form-player
3. ⚠️ Database Queries — 2x N+1 encontradas (P1), 3x select('*') (P2)
4. ⚠️ Bundle Size & Assets — logo 4.9 MB não otimizado (P3), imagens com `<img>` (P2)
5. ✅ Unused Exports & Dead Code — limpo, 3 TODOs apenas
6. ⚠️ Performance Patterns — JSON.stringify em comparação (P2), map().filter() OK

## Issues Encontrados

### P1 (Critical/High) — PRECISA CORREÇÃO

1. **N+1: POST /api/forms — profile lookup duplicado** [HIGH]
   - **Arquivo:** `app/api/forms/route.ts` linhas 102-107
   - **Issue:** Buscando `plan` em query separada quando já tem acesso via user
   - **Impact:** 1 query extra por form criado
   - **Fix:** Retornar `plan` de `getRequestUser()` ou cache
   - **Esforço:** ~15 minutos

2. **N+1: GET /api/admin/users — forms count em memória** [HIGH]
   - **Arquivo:** `app/api/admin/users/route.ts` linhas 30-35
   - **Issue:** Trazer TODOS os forms sem filtro, agregar em loop
   - **Impact:** 100k+ rows desnecessariamente em escala
   - **Fix:** Usar `.select('user_id', { count: 'exact' })` ou VIEW
   - **Esforço:** ~20 minutos

### P2 (Medium) — DEVERIA CORRIGIR

1. **Form-player sem React.memo — re-renders excessivos** [MEDIUM]
   - **Arquivo:** `components/form-player/form-player.tsx` (720 linhas)
   - **Issue:** Componente GRANDE não memoizado, rende todo tree ao mudar state
   - **Risk:** 500+ re-renders evitáveis em formulários 50+ campos
   - **Fix:** Memoizar FormPlayer, QuestionRenderer, FileUploadQuestion com useCallback
   - **Esforço:** ~45 minutos

2. **select('*') desnecessário em 2 rotas** [MEDIUM]
   - **Arquivos:** `app/api/forms/[id]/duplicate/route.ts:52`, `app/api/domains/route.ts:26`
   - **Issue:** Buscar todas as colunas quando só precisa de algumas
   - **Impact:** Aumenta payload/banda de rede
   - **Fix:** Listar apenas colunas necessárias
   - **Esforço:** ~10 minutos

3. **Imagens não otimizadas — logo-eidosform.png 4.9 MB** [MEDIUM]
   - **Arquivo:** `public/logo-eidosform.png`
   - **Issue:** Logo GIGANTE, deveria ser WebP ~100 KB
   - **Impact:** Lento load em 3G/4G, impacta LCP
   - **Fix:** `cwebp -q 80 logo-eidosform.png -o logo-eidosform.webp`
   - **Esforço:** ~10 minutos

4. **Imagens com `<img>` ao invés de Next.js `<Image>`** [MEDIUM]
   - **Arquivos:** 3 componentes (eidos-logo.tsx, watermark.tsx, form-player.tsx)
   - **Issue:** Sem lazy-load, srcset, WebP auto, possível CLS
   - **Impact:** Impacta performance e UX
   - **Fix:** Usar `<Image>` do Next.js para todas as imagens dinâmicas
   - **Esforço:** ~20 minutos

5. **JSON.stringify em comparações (TiptapEditor)** [MEDIUM]
   - **Arquivo:** `components/ui/tiptap/TiptapEditor.tsx` linhas 320-321
   - **Issue:** `JSON.stringify()` para comparar objetos é LENTO
   - **Risk:** Lag em edição de conteúdo
   - **Fix:** Usar `deepEqual()` ou estrutura imutável (Immer)
   - **Esforço:** ~15 minutos

### P3 (Low) — NICE-TO-HAVE

1. **Ativar TypeScript noUnusedLocals** — futuro
2. **Funções inline em onClick handlers** — 15+ instâncias de `onClick={() => ...}`
3. **TODOs de segurança (Turnstile, Redis scaling)** — planejados

## Decisões tomadas

1. **P1s são bloqueantes** para release em alta carga
2. **P2 Form-player é CRÍTICO** para UX de formulários grandes
3. **Performance: BOA com oportunidades** — não há crítico, mas escalabilidade precisa atenção
4. **Build size OK** — 323 MB é aceitável para Next.js moderno

## Arquivos alterados

- ✅ `/home/sidney/eidosform/audit-etapa-7.md` — CRIADO (relatório 280+ linhas)

## Estado atual

- ⏳ **AUDITORIA COMPLETA, AGUARDANDO FIXES**
- 2 P1 → Zeca (queries, rápido)
- 5 P2 → Toin (React performance) + Zeca (imagens, queries)
- 3 P3 → Futuro

## Pendências

- [ ] Corrigir N+1 em POST /api/forms (profile lookup)
- [ ] Corrigir N+1 em GET /api/admin/users (forms count)
- [ ] Memoizar FormPlayer e componentes filhos (React.memo + useCallback)
- [ ] Remover select('*') em 2 rotas
- [ ] Otimizar logo-eidosform.png para WebP
- [ ] Converter imagens de `<img>` para `<Image>`
- [ ] Corrigir JSON.stringify em TiptapEditor

## Próximo passo sugerido

**Ciclo QA Automático:**
1. **Toin:** Corrigir memoização em form-player (45 min)
2. **Zeca:** Corrigir N+1 queries (35 min) + otimizar imagens (10 min)
3. **Zéfa:** Revalidação dos fixes

**Timeline:** ~2 horas de trabalho total

---

**Zéfa**  
Agente de Auditoria — EidosForm  
Status: ETAPA 7 Completa ✅ | Aguardando Fixes P1/P2 ⏳
