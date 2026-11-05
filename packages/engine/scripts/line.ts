// npx tsx scripts/line.ts "creature|artifact|enchantment|instant|sorcery" "oracle text; use | for a new line"
import { parseCard } from "../src/index.js";
const type = process.argv[2] as any;
const text = process.argv[3].split("|").join("\n").replace(/^•/gm, "• ").replace(/^•  /gm, "• ");
const def: any = { id: "x", name: "Testcard", type, cost: 3, manaCost: "{2}{U}", text, typeLine: type === "creature" ? "Creature — Test" : type, ...(type === "creature" ? { power: 2, toughness: 2 } : {}) };
const r = parseCard(def);
console.log("ok:", r.ok, "unsupported:", JSON.stringify(r.unsupported));
console.log(JSON.stringify({ statics: r.statics, triggers: r.triggers.map((t) => ({ event: t.event, effects: t.effects, modes: t.modes?.length })), activated: r.activated.map((a) => ({ mana: a.mana, effects: a.effects })) }).slice(0, 700));
