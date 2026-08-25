## Handoff — Codex — 2026-08-25 14:20 BRT

### O que foi feito
- Auditoria somente leitura do incidente `expire-plans` de 25/08/2026.
- Confrontados briefing, implementação, testes, crontab, wrapper da VPS, `cron.log` e documentação oficial da Vercel.
- Executados 75 testes focados (`dunning-engine`, `expire-plans`, rota `dunning`): todos passaram.

### Decisões tomadas
- A causa raiz do incidente permanece não determinada.
- A afirmação de que o perfil manteve acesso pago integral não é sustentável: os principais gates usam `getEffectivePlan` e tratam `plan_expires_at` vencido como Free, enquanto `plan-features` ainda devolve Plus durante a inadimplência. Existe split-brain e a carência de 5 dias não preserva de forma coerente os benefícios pagos.
- Manter detector de efeito e heartbeat/run ledger como sinais complementares; não substituir um pelo outro.
- Inserir antes da sequência 1→2→3 a decisão/correção da semântica da carência, da inconsistência de `revErr` e da contabilidade de desfechos.

### Arquivos alterados
- `handoff.md` apenas (nenhum código ou configuração alterado).

### Estado atual
- `b5e21bb` continua em `main`/`origin/main` com a causa inferida escrita como fato.
- Crontab instalado usa hora local: `20 3 * * *` = 03:20 BRT/06:20Z; ainda não havia executado na hora da auditoria.
- Watchdog tem ponto cego em D+5 e pode consumir o marcador diário mesmo se o alerta não for entregue.

### Pendências
- Decidir o contrato real da carência: manter benefícios pagos até D+5 ou degradar no fim do período; alinhar todos os gates, cota, formulários e dashboard.
- Corrigir afirmações factualmente insustentáveis em `DEPLOY.md`, commit subsequente e comentário do crontab.
- Definir e implementar correção `revErr`, classificação completa de resultados, detector D+5 com SLA, run ledger e alertas duráveis.
- Corrigir o wrapper para preservar exit code e emitir registro atômico.

### Próximo passo sugerido
- Fechar primeiro a semântica da carência e transformar o parecer em um plano de mudanças pequeno; deixar a migration do run ledger pronta para o dono executar no SQL Editor.
