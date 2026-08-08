import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@shop-overlap/api-contract": fileURLToPath(new URL("../api-contract/src/index.ts", import.meta.url)),
    },
  },
  test: { environment: "node" },
});
