# Contribuindo com o EidosForm

Obrigado pelo interesse em contribuir! Este documento explica o fluxo de trabalho da equipe Eidos.

## Time

- **Zeca** — Backend (APIs, banco de dados, integrações)
- **Toin** — Frontend (componentes, UI/UX)
- **Zéfa** — QA & DevOps (testes, CI/CD, validações)

## Fluxo de Trabalho

### 1. Branches

- `main` — branch principal, sempre estável
- `feature/nome-da-feature` — novas funcionalidades
- `fix/nome-do-bug` — correções de bugs
- `hotfix/nome` — correções urgentes em produção

### 2. Antes de fazer PR

Certifique-se de que:

```bash
# Build passa
npm run build

# Sem erros de TypeScript
npx tsc --noEmit

# Linting limpo
npm run lint

# Sem secrets hardcoded
grep -rn "sk-\|password.*=" --include="*.ts" --include="*.tsx" .
```

### 3. Padrões de código

- **TypeScript estrito** — sem `any` implícito, tipos explícitos em props e returns
- **Commits em inglês** — use convenção: `feat:`, `fix:`, `docs:`, `chore:`
- **Componentes:** server components por padrão, client components apenas quando necessário
- **API routes:** sempre validar autenticação antes de qualquer operação de dados

### 4. Segurança

- Nunca commitar `.env.local` ou qualquer arquivo com credenciais
- Toda rota `/api/` que modifica dados **deve** checar autenticação
- Usar sempre `supabase.auth.getUser()` para validar sessões server-side

### 5. Testes

Antes de abrir PR, rode manualmente:

- Fluxo de login → dashboard → criar form → publicar → preencher → ver respostas
- Verificar que build de produção (`npm run build`) passa sem erros

### 6. Pull Requests

- Descreva o que mudou e por quê
- Adicione screenshots se for mudança visual
- Marque a Zéfa para review de QA quando afetar endpoints de API
