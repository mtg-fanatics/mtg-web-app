import { parseStatic } from "../src/oracle/abilities.js";
import { forEachCount } from "../src/oracle/words.js";
console.log(JSON.stringify(forEachCount("basic island you control")), JSON.stringify(parseStatic("creatures you control get +1/+0 for each basic island you control")));
