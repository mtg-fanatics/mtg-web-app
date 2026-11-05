// Sets cards.playable for one set to what the engine says.   node scripts/fdnflip.mjs [set = fdn] [--apply]
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { isSupportedCard } from "@mtg/engine";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const set = process.argv.find((a, i) => i > 1 && !a.startsWith("--")) ?? "fdn";
const apply = process.argv.includes("--apply");
const rows = [];
for (let from = 0; ; from += 1000) {
  const r = await db.from("cards").select("id,name,type,type_line,mana_cost,cost,oracle_text,keywords,power,toughness,colors,playable").eq("set_code", set).range(from, from + 999);
  if (r.error) throw new Error(r.error.message);
  rows.push(...r.data);
  if (r.data.length < 1000) break;
}
const def = (c) => ({ id: c.id, name: c.name, type: c.type, cost: c.cost, power: c.power ?? undefined, toughness: c.type === "planeswalker" ? undefined : (c.toughness ?? undefined), loyalty: c.type === "planeswalker" ? (c.toughness ?? undefined) : undefined, typeLine: c.type_line, manaCost: c.mana_cost ?? undefined, text: c.oracle_text ?? "", colors: c.colors ?? [], keywords: (c.keywords ?? []).map((k) => k.toLowerCase()) });
const KINDS = ["land", "creature", "artifact", "enchantment", "planeswalker", "instant", "sorcery"];
const want = (c) => KINDS.includes(c.type) && isSupportedCard(def(c));
const up = rows.filter((c) => !c.playable && want(c));
const down = rows.filter((c) => c.playable && !want(c));
console.log(`${rows.length} cards in ${set}; playable now ${rows.filter((c) => c.playable).length}; engine supports ${rows.filter(want).length}; to turn on ${up.length}; to turn off ${down.length}`);
if (down.length) console.log("would turn OFF:", down.map((c) => c.name).join(", "));
if (!apply) process.exit(0);
for (const [ids, value] of [[up.map((c) => c.id), true], [down.map((c) => c.id), false]]) {
  if (!ids.length) continue;
  const { error } = await db.from("cards").update({ playable: value }).in("id", ids);
  if (error) throw new Error(error.message);
  console.log(`set playable=${value} on ${ids.length} cards`);
}
