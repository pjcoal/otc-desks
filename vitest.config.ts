import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const webSrc = fileURLToPath(new URL("./apps/web/src", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": webSrc } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
          exclude: ["**/*.int.test.ts", "**/*.chain.test.ts", "**/node_modules/**"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["packages/*/src/**/*.int.test.ts", "apps/*/src/**/*.int.test.ts"],
          fileParallelism: false,
          environment: "node",
          globalSetup: ["./test/global-setup-db.ts"],
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
      {
        extends: true,
        test: {
          name: "chain",
          include: ["packages/*/src/**/*.chain.test.ts"],
          environment: "node",
          testTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
