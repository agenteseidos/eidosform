import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // services/whatsapp roda fora do Next (Node puro na VPS, CommonJS): a regra
  // de "no require()" do preset TS não se aplica lá (P3-1, auditoria 2026-05-18).
  {
    files: ["services/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Convenção: prefixo "_" marca variável intencionalmente não usada
  // (ex.: `const { actionsOn: _ao, ...rest }` para excluir campo do spread).
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
]);

export default eslintConfig;
