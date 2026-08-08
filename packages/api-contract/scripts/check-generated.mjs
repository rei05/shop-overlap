import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "shop-overlap-openapi-"));
const output = join(directory, "openapi.generated.ts");
const source = "Sources/ShopOverlapAPI/openapi.yaml";
const checkedIn = "src/openapi.generated.ts";

try {
  execFileSync("openapi-typescript", [source, "--output", output], { stdio: "inherit" });
  if (readFileSync(output, "utf8") !== readFileSync(checkedIn, "utf8")) {
    console.error(`Generated contract is stale. Run: npm run generate --workspace @shop-overlap/api-contract`);
    process.exitCode = 1;
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
