// Which Foundations cards does the engine (from source) not understand yet, and why.   npx tsx scripts/fdn.ts [filter]
import fs from "node:fs";
import { failedSentences, isSupportedCard, keywordsSupported, parseCard } from "../src/index.js";
import type { CardDef } from "../src/index.js";
const rows = JSON.parse(fs.readFileSync(new URL("./fdn-cards.json", import.meta.url), "utf8"));
const def = (c: any): CardDef => ({ id: c.id, name: c.name, type: c.type, cost: c.cost, power: c.power ?? undefined, toughness: c.type === "planeswalker" ? undefined : (c.toughness ?? undefined), loyalty: c.type === "planeswalker" ? (c.toughness ?? undefined) : undefined, typeLine: c.type_line, manaCost: c.mana_cost ?? undefined, text: c.oracle_text ?? "", colors: c.colors ?? [], keywords: (c.keywords ?? []).map((k: string) => k.toLowerCase()) }) as CardDef;
const filter = process.argv[2];
let ok = 0; const bad: [string, string[]][] = [];
for (const c of rows) {
  const d = def(c);
  if (isSupportedCard(d)) { ok++; continue; }
  const out: string[] = [];
  for (const k of d.keywords ?? []) if (!keywordsSupported({ ...d, keywords: [k] })) out.push("keyword: " + k);
  for (const s of failedSentences(d)) out.push("text: " + s.slice(0, 140));
  if (out.length === 0) out.push(...parseCard(d).unsupported.map((x) => "line: " + x.slice(0, 140)), ...(parseCard(d).unsupported.length ? [] : ["(other)"]));
  bad.push([c.name, out]);
}
console.log(`supported ${ok} / ${rows.length}; failing ${bad.length}`);
for (const [n, rs] of bad) if (!filter || n.toLowerCase().includes(filter.toLowerCase()) || rs.some((r) => r.toLowerCase().includes(filter.toLowerCase()))) console.log("-", n, "\n   " + rs.join("\n   "));
