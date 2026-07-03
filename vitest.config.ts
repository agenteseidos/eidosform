import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    exclude: [
      // Testes SCRIPT-STYLE (rodam com `npx tsx <arquivo>`, usam process.exit) — não são
      // compatíveis com o runner do vitest. (lib/proration.test.ts foi convertido p/ Vitest.)
      'lib/plan-change.test.ts',
      'lib/billing-activation.test.ts',
      'lib/asaas-external-ref.test.ts',
      // **/node_modules: o default 'node_modules/**' só cobre a raiz — services/whatsapp/
      // node_modules trazia ~580 arquivos de teste de dependências pro bare `vitest run`.
      '**/node_modules/**',
      // Worktrees de agente (raiz e docs) contêm cópias dos testes → falhas espúrias.
      '.claude/worktrees/**',
      'docs/.claude/**',
    ],
  },
})
