import { defineConfig } from "vitest/config";
import * as path from "path";

export default defineConfig({
  resolve: {
    alias: {
      // node:sqlite (Node >= 22) is a real builtin, but this Vite version
      // doesn't know it and tries to resolve it as an npm package. In TESTS
      // only, route it through a CJS shim that requires the builtin at
      // runtime; tsx/production resolves the builtin natively.
      "node:sqlite": path.resolve(__dirname, "apps/api/src/services/sqlite.native.cjs"),
    },
  },
  test: {
    include: ["packages/*/tests/**/*.test.ts", "apps/*/tests/**/*.test.ts"],
    exclude: ["node_modules/**", "contracts/**"],
    // detector golden regression needs live RPC only when RUN_GOLDEN=1;
    // it self-skips otherwise.
    testTimeout: 30_000,
  },
});
