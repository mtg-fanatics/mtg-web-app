import type { CardDef } from "./types.js";

/** Combat keywords the engine implements. A creature with any other keyword isn't playable yet. */
export const SUPPORTED_KEYWORDS = [
  "flying",
  "reach",
  "first strike",
  "double strike",
  "deathtouch",
  "lifelink",
  "trample",
  "vigilance",
  "haste",
  "defender",
  "menace",
  "indestructible",
  "flash",
  "hexproof",
  "prowess",
  "fear",
  "intimidate",
  "infect",
  "shroud",
  "shadow",
  "horsemanship",
  "wither",
] as const;

export type Keyword = (typeof SUPPORTED_KEYWORDS)[number];

const SUPPORTED = new Set<string>(SUPPORTED_KEYWORDS);

/** What each keyword does, in plain words (shown to players). */
export const KEYWORD_RULES: Record<Keyword, string> = {
  flying: "Can be blocked only by creatures with flying or reach.",
  reach: "Can block creatures with flying.",
  "first strike": "Deals combat damage before creatures without first strike.",
  "double strike": "Deals combat damage twice: once with first strike and once with regular damage.",
  deathtouch: "Any amount of damage this deals to a creature is enough to destroy it.",
  lifelink: "Damage dealt by this also gains its controller that much life.",
  trample: "If blocked, assigns lethal damage to the blockers and the rest to the defending player.",
  vigilance: "Attacking doesn't cause it to tap.",
  haste: "Can attack the turn it comes into play.",
  defender: "Can't attack.",
  menace: "Can't be blocked except by two or more creatures.",
  indestructible: "Isn't destroyed by lethal damage or deathtouch.",
  flash: "Can be cast any time you could cast an instant.",
  hexproof: "Can't be the target of spells or abilities your opponents control.",
  prowess: "Whenever you cast a noncreature spell, this gets +1/+1 until end of turn.",
  fear: "Can't be blocked except by artifact creatures and/or black creatures.",
  intimidate: "Can't be blocked except by artifact creatures and/or creatures that share a color with it.",
  shroud: "Can't be the target of spells or abilities (even its controller's).",
  shadow: "Can block or be blocked by only creatures with shadow.",
  horsemanship: "Can't be blocked except by creatures with horsemanship.",
  wither: "Deals damage to creatures in the form of -1/-1 counters.",
  infect: "Deals damage to creatures in the form of -1/-1 counters and to players in the form of poison counters. A player with ten or more poison counters loses the game.",
};

export const hasKeyword = (def: CardDef, keyword: Keyword): boolean =>
  (def.keywords ?? []).some((k) => k.toLowerCase() === keyword);

/** Keywords that are just labels for a line the text reader handles itself ("Enchant creature"). */
const LABELS = new Set([
  "enchant", "cycling", "regenerate", "scry", "mill", "surveil", "devoid", "partner", "changeling", "landwalk",
  "treasure", "battalion", "pack tactics", "double", "food", "investigate", "equip", "landcycling", "typecycling", "basic landcycling", "airbend", "connive", "power-up", "plainscycling", "islandcycling", "swampcycling", "mountaincycling", "forestcycling", "kicker", "flashback", "protection", "landfall", "ward", "crew",
  "heal", "fight", "swampwalk", "islandwalk", "forestwalk", "mountainwalk", "plainswalk",
  "eerie", "prepared", "raid",
  "explore", "solved", "infusion", "warp", "blight", "offspring", "toxic", "exalted", "delve", "ferocious", "delirium", "plot", "flurry", "replicate",
  "opus", "harmonize", "echo", "cumulative upkeep", "threshold", "hellbent", "metalcraft", "morbid", "heroic", "bushido", "renown", "extort", "bloodthirst", "affinity", "buyback", "amass", "storm", "cascade", "convoke",
  // Jund Sacrifice and its sideboard
  "revolt", "learn", "channel", "waterbend", "firebending", "paradigm", "blood",
  // Mono-Black Infect
  "proliferate",
  // Mono-Green Stompy
  "undying", "undergrowth", "persist",
  // Marvel Super Heroes: "teamwork" is read by the card reader; the rest are names in front of an ability ("Radar Sense — ...")
  "teamwork", "transform", "enrage", "avian telepathy", "radar sense", "sonic attack", "unbreakable skin", "embiggen fist", "wasp's sting", "street justice", "legal justice",
  "trick arrows", "net", "explosive", "boomerang", "intangibility", "cosmic awareness", "photographic reflexes", "cybernetic senses", "mental organism",
  "designed only for killing", "no one dies!", "i love squirrels!", "brontosaurus", "tyrannosaurus rex", "solar beam", "density control", "technopathy", "seismic takedown",
]);

/** True if every keyword printed on the card is one the engine implements. */
export const keywordsSupported = (def: CardDef): boolean => (def.keywords ?? []).every((k) => SUPPORTED.has(k.toLowerCase()) || LABELS.has(k.toLowerCase()));
