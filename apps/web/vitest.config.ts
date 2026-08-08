import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shop-overlap/api-contract": fileURLToPath(new URL("../../packages/api-contract/src/index.ts", import.meta.url)),
      "@shop-overlap/shared-ts": fileURLToPath(new URL("../../packages/shared-ts/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    exclude: ["node_modules/**", ".next/**"],
    coverage: { reporter: ["text", "json", "html"] },
  },
});
