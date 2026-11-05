// Why each unplayable card of one set fails.   node scripts/fdnsurvey.mjs [set = fdn]
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { failedSentences, isSupportedCard, keywordsSupported, parseCard } from "@mtg/engine";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const set = process.argv[2] ?? "fdn";
const rows = [];
for (let from = 0; ; from += 1000) {
  const r = await db.from("cards").select("id,name,type,type_line,mana_cost,cost,oracle_text,keywords,power,toughness,colors,playable").eq("set_code", set).range(from, from + 999);
  if (r.error) throw new Error(r.error.message);
  rows.push(...r.data);
  if (r.data.length < 1000) break;
}
const def = (c) => ({ id: c.id, name: c.name, type: c.type, cost: c.cost, power: c.power ?? undefined, toughness: c.type === "planeswalker" ? undefined : (c.toughness ?? undefined), loyalty: c.type === "planeswalker" ? (c.toughness ?? undefined) : undefined, typeLine: c.type_line, manaCost: c.mana_cost ?? undefined, text: c.oracle_text ?? "", colors: c.colors ?? [], keywords: (c.keywords ?? []).map((k) => k.toLowerCase()) });
const bad = rows.filter((c) => !c.playable);
console.log(rows.length, "cards in", set, "; flagged unplayable:", bad.length);
const engineOk = bad.filter((c) => ["land", "creature", "artifact", "enchantment", "planeswalker", "instant", "sorcery"].includes(c.type) && isSupportedCard(def(c)));
console.log("flag is false but the ENGINE already supports them:", engineOk.length, engineOk.slice(0, 8).map((c) => c.name).join(", "));
const by = new Map();
for (const c of bad) {
  const d = def(c);
  if (engineOk.includes(c)) continue;
  const out = [];
  if (!["land", "creature", "artifact", "enchantment", "planeswalker", "instant", "sorcery"].includes(c.type)) out.push("type: " + c.type);
  for (const k of d.keywords) if (!keywordsSupported({ ...d, keywords: [k] })) out.push("keyword: " + k);
  for (const s of failedSentences(d)) out.push("text: " + s.replace(/\d+/g, "N").slice(0, 110));
  if (out.length === 0) { const l = parseCard(d).unsupported.map((x) => "line: " + x.slice(0, 110)); out.push(...(l.length ? l : ["(other)"])); }
  for (const r of out) (by.get(r) ?? by.set(r, []).get(r)).push(c.name);
}
const sorted = [...by].sort((a, b) => b[1].length - a[1].length);
console.log("distinct reasons:", sorted.length);
for (const [r, names] of sorted) console.log(String(names.length).padStart(3), r, " <- ", names.slice(0, 3).join(" | "));
fs.writeFileSync(process.env.OUT ?? "fdn-survey.json", JSON.stringify(sorted));
