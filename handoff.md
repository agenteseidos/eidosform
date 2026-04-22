## Handoff — Toin — 2026-04-22 02:48 GMT-3

### O que foi feito
- Implementei a política de downgrade rigorosa em `lib/plan-limits.ts`
- Troquei o critério dos 3 forms ativos: agora mantém os 3 forms publicados com menor número de respostas
- Forms com `100+` respostas agora nunca entram entre os ativos no downgrade para free
- Mantive o comportamento de `handleUpgrade()` despausando todos os forms
- Reforcei o gate de webhooks na API v1 (`app/api/v1/forms/[id]/route.ts`) para não disparar webhook em plano free
- Verifiquei que o form público já bloqueia pixels corretamente em plano free (`canShowPixels`)

### Decisões tomadas
- Contagem de respostas foi feita usando a tabela `responses`, agregada em memória por `form_id`
- Empates no número de respostas são embaralhados aleatoriamente dentro do grupo empatado
- Se todos os forms publicados tiverem `100+` respostas, todos ficam pausados
- Features premium não foram apagadas do banco; só ficam desativadas em runtime quando o plano é free

### Arquivos alterados
- `/home/sidney/eidosform/lib/plan-limits.ts`
- `/home/sidney/eidosform/app/api/v1/forms/[id]/route.ts`
- `/home/sidney/eidosform/handoff.md`

### Estado atual
- `handleDowngrade()` agora:
  - despausa tudo primeiro
  - conta respostas por form
  - separa forms elegíveis (`< 100` respostas) dos sempre pausados (`>= 100`)
  - escolhe até 3 forms com menor número de respostas
  - pausa o restante
- Pixels no form público já continuam bloqueados em plano free ✅
- Webhooks no fluxo público já estavam bloqueados por plano ✅
- Webhooks na API v1 agora também respeitam o plano ✅
- `handleUpgrade()` continua suficiente para reativar tudo após upgrade ✅

### Verificação
- `npx next build` compilou o código e passou no TypeScript ✅
- O build falhou depois em coleta de page data por erro de ambiente preexistente: `supabaseUrl is required` em `/api/form/[id]/whatsapp/settings`
- Esse erro não foi introduzido por esta mudança

### Pendências
- Commitar e pushar as alterações
- Rodar a notificação final do agente
- Idealmente revalidar com Zéfa após o commit

### Próximo passo sugerido
- Commit: `feat: política de downgrade rigorosa — 3 forms com menor preenchimento, features premium desativadas`
- Push para `origin main`
- Acionar Zéfa para auditoria final do diff