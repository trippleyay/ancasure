import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/tests/**/*.test.ts"],
    exclude: ["node_modules/**", "contracts/**"],
    // detector golden regression needs live RPC only when RUN_GOLDEN=1;
    // it self-skips otherwise.
    testTimeout: 30_000,
  },
});
