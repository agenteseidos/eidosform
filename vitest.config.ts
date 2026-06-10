import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    // docs/.claude: worktrees temporárias de agente podem conter cópias dos testes —
    // sem o exclude, `vitest run` as executa e reporta falhas espúrias.
    exclude: ['lib/proration.test.ts', 'node_modules/**', 'docs/.claude/**'],
  },
})
