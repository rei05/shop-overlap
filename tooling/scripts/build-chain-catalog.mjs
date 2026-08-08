import { readFile, writeFile, mkdir } from "node:fs/promises";

const sourceUrl = new URL(
  "../../node_modules/name-suggestion-index/dist/json/nsi.min.json",
  import.meta.url,
);
const outputUrl = new URL("../../packages/chain-catalog/data/chains.jp.json", import.meta.url);
const source = JSON.parse(await readFile(sourceUrl, "utf8"));
const byIdentity = new Map();

for (const [category, collection] of Object.entries(source.nsi)) {
  if (!category.startsWith("brands/")) continue;

  for (const item of collection.items ?? []) {
    const include = (item.locationSet?.include ?? []).filter(
      (entry) => typeof entry === "string",
    );
    const appliesToJapan = include.some(
      (entry) => entry === "001" || entry === "jp" || entry.startsWith("jp-"),
    );
    if (!appliesToJapan) continue;

    const tags = item.tags ?? {};
    const wikidata = tags["brand:wikidata"];
    const canonicalName = tags["name:ja"] ?? tags.name ?? tags.brand ?? item.displayName;
    if (!canonicalName) continue;

    const aliases = new Set([
      item.displayName,
      tags.brand,
      tags["brand:ja"],
      tags["brand:en"],
      tags.name,
      tags["name:ja"],
      tags["name:en"],
      tags.official_name,
      ...(item.matchNames ?? []),
    ].filter(Boolean));
    aliases.delete(canonicalName);

    const record = {
      id: wikidata ? `wikidata:${wikidata}` : `nsi:${item.id}`,
      name: canonicalName,
      ...(wikidata ? { wikidata } : {}),
      aliases: [...aliases].slice(0, 10),
      category: category.replace(/^brands\//, ""),
    };
    const key = wikidata ?? `${canonicalName.toLocaleLowerCase("ja")}::${record.category}`;
    const existing = byIdentity.get(key);
    const japanSpecific = include.some((entry) => entry === "jp" || entry.startsWith("jp-"));

    if (!existing || (japanSpecific && !existing.japanSpecific)) {
      byIdentity.set(key, { ...record, japanSpecific });
    }
  }
}

const output = [...byIdentity.values()]
  .map((record) => {
    const outputRecord = { ...record };
    delete outputRecord.japanSpecific;
    return outputRecord;
  })
  .sort((a, b) => a.name.localeCompare(b.name, "ja"));

await mkdir(new URL("../../packages/chain-catalog/data/", import.meta.url), { recursive: true });
await writeFile(outputUrl, `${JSON.stringify(output)}\n`, "utf8");
console.log(`Generated ${output.length} Japanese chain entries.`);
