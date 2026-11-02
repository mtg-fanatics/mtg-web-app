// Which missing pieces of card text keep the most cards unplayable? (all single-faced cards in the importer's cache)
//   npx tsx scripts/survey.ts [how many to list = 60]
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { failedSentences, isSupportedCard, keywordsSupported, parseCard } from "../src/index.js";
import type { CardDef } from "../src/index.js";

const TYPES = [["Land", "land"], ["Creature", "creature"], ["Planeswalker", "planeswalker"], ["Instant", "instant"], ["Sorcery", "sorcery"], ["Enchantment", "enchantment"], ["Artifact", "artifact"], ["Battle", "battle"]] as const;
const cacheDir = path.resolve("../../mtg/.import-cache");
const file = fs.readdirSync(cacheDir).filter((f) => f.startsWith("oracle-cards") && f.endsWith(".jsonl.gz")).sort().pop()!;
const lines = zlib.gunzipSync(fs.readFileSync(path.join(cacheDir, file))).toString("utf8").split("\n").filter(Boolean);
const limit = Number(process.argv[2] ?? 60);

const solo = new Map<string, string[]>(); // reason -> cards that this ONE reason alone keeps out
const sets: { name: string; r: Set<string> }[] = [];
for (const line of lines) {
  const c = JSON.parse(line);
  if (c.layout !== "normal" || c.card_faces) continue;
  const front = (c.type_line as string).split("—")[0];
  const type = TYPES.find(([w]) => front.includes(w))?.[1];
  if (!type || type === "battle") continue;
  const def: CardDef = { id: "x", name: c.name, type, cost: Math.round(c.cmc), power: /^\d+$/.test(c.power ?? "") ? Number(c.power) : undefined, toughness: /^\d+$/.test(c.toughness ?? "") ? Number(c.toughness) : undefined, loyalty: /^\d+$/.test(c.loyalty ?? "") ? Number(c.loyalty) : undefined, typeLine: c.type_line, manaCost: c.mana_cost ?? "", text: c.oracle_text ?? "", keywords: (c.keywords ?? []).map((k: string) => k.toLowerCase()) };
  if (isSupportedCard(def)) continue;
  const r = new Set<string>();
  if (type === "creature" && (def.power === undefined || def.toughness === undefined) && !parseCard(def).dynamicStats) r.add("star stats");
  for (const k of def.keywords!) if (!keywordsSupported({ ...def, keywords: [k] })) r.add(`KEYWORD ${k}`);
  for (const s of failedSentences(def)) r.add("TEXT " + s.replace(/\d+/g, "N").slice(0, 100));
  // a keyword also shows up as a text sentence: count them once
  for (const x of [...r]) if (x.startsWith("TEXT ") && r.has("KEYWORD " + x.slice(5).split(" ")[0])) r.delete(x);
  sets.push({ name: c.name, r });
  if (r.size === 1) {
    const k = [...r][0];
    (solo.get(k) ?? solo.set(k, []).get(k)!).push(c.name);
  }
}
console.log(sets.length, "unplayable;", [...solo.values()].reduce((a, b) => a + b.length, 0), "of them are blocked by exactly one thing");
for (const [r, v] of [...solo].sort((a, b) => b[1].length - a[1].length).slice(0, limit)) console.log(String(v.length).padStart(5), r, "  e.g.", v.slice(0, 3).join(" | "));
