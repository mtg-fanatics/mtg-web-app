import { parseModes } from "../src/oracle/effectText.js";
import { parseCreatureLine } from "../src/oracle/lines.js";
import { stripModeName } from "../src/oracle/teamwork.js";
const bullets = ["you gain 2 life.", "you draw a card and you lose 1 life."];
console.log(JSON.stringify(parseModes(bullets.map(stripModeName), true))?.slice(0, 200));
const probe: any = { ok: true, triggers: [], activated: [], unsupported: [] };
parseCreatureLine("at the beginning of your end step, if a creature died this turn, you gain 1 life", probe);
console.log(JSON.stringify(probe).slice(0, 300));
