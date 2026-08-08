import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@shop-overlap/api-contract": fileURLToPath(new URL("../../packages/api-contract/src/index.ts", import.meta.url)),
      "@shop-overlap/chain-catalog": fileURLToPath(new URL("../../packages/chain-catalog/src/index.ts", import.meta.url)),
      "@shop-overlap/shared-ts": fileURLToPath(new URL("../../packages/shared-ts/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    exclude: ["node_modules/**", ".wrangler/**"],
  },
});
