import fs from "node:fs";
const rows = JSON.parse(fs.readFileSync(new URL("./fdn-cards.json", import.meta.url), "utf8"));
for (const n of process.argv.slice(2)) for (const c of rows.filter((r: any) => r.name.toLowerCase().includes(n.toLowerCase()))) console.log(`## ${c.name} ${c.mana_cost ?? ""} [${c.type_line}] ${c.power ?? ""}/${c.toughness ?? ""}\n${c.oracle_text}\n`);
