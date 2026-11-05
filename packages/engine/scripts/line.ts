// npx tsx scripts/line.ts "creature|artifact|enchantment|instant|sorcery" "oracle text with \n for new lines"
import { parseCard } from "../src/index.js";
const type = process.argv[2] as any;
const text = process.argv[3].replace(/\n/g, "\n");
const def: any = { id: "x", name: "Testcard", type, cost: 3, manaCost: "{2}{U}", text, typeLine: type === "creature" ? "Creature — Test" : type, ...(type === "creature" ? { power: 2, toughness: 2 } : {}) };
const r = parseCard(def);
console.log("ok:", r.ok, "unsupported:", JSON.stringify(r.unsupported));
console.log(JSON.stringify({ statics: r.statics, triggers: r.triggers.map((t) => ({ event: t.event, effects: t.effects })), activated: r.activated.map((a) => ({ mana: a.mana, effects: a.effects })) }).slice(0, 700));
