import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "packages/database/src/generated/**", "**/*.tsbuildinfo", "apps/web/next-env.d.ts", ".embedded-pg/**", "**/playwright-report/**", "**/test-results/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["warn", { fixStyle: "inline-type-imports", disallowTypeAnnotations: false }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "smart"],
      // Numeric safety: amounts are parsed with parseUnits()/BigInt, never with float parsing.
      "no-restricted-globals": ["error", { name: "parseFloat", message: "Use parseUnits() / Decimal for amounts." }, { name: "parseInt", message: "Use BigInt() for integer amounts." }],
    },
  },
  {
    files: ["apps/web/src/**/*.tsx", "apps/web/src/**/*.ts"],
    plugins: { "react-hooks": reactHooks },
    rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn" },
  },
  {
    files: ["scripts/**", "**/*.test.ts", "**/testing/**", "test/**", "**/seed-demo.ts", "**/e2e/**"],
    rules: { "no-console": "off" },
  },
);
