import type { ChainOption } from "@shop-overlap/api-contract";
import chainCatalog from "../data/chains.jp.json";

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ja").replace(/[\s・･'’\-ー]/g, "");
}

/** Search the build-time Name Suggestion Index catalog generated for Japan. */
export function findChains(query: string): ChainOption[] {
  const needle = normalize(query.trim());
  const catalog = chainCatalog as ChainOption[];
  if (!needle) return catalog.slice(0, 10);

  return catalog
    .flatMap((chain) => {
      const names = [chain.name, ...(chain.aliases ?? [])].map(normalize);
      const score = Math.min(...names.map((name) =>
        name === needle ? 0 : name.startsWith(needle) ? 1 : name.includes(needle) ? 2 : 99,
      ));
      return score < 99 ? [{ chain, score }] : [];
    })
    .sort((a, b) =>
      a.score - b.score ||
      a.chain.name.length - b.chain.name.length ||
      a.chain.name.localeCompare(b.chain.name, "ja"))
    .slice(0, 10)
    .map(({ chain }) => chain);
}
