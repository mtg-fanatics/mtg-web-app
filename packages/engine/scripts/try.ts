// npx tsx scripts/try.ts "sentence"   -> how the effect reader understands it (as a spell/ability text)
import { newCtx } from "../src/oracle/targets.js";
import { parseEffectText } from "../src/oracle/effectText.js";
const ctx = newCtx(true);
console.log(JSON.stringify(parseEffectText(process.argv[2].toLowerCase(), ctx)), JSON.stringify(ctx.targets.map((t) => t.label)));
