import type { GameEvent } from "../actions.js";
import type { Amount, Effect, PendingPick, RunContext } from "../effects.js";
import type { GameState } from "../types.js";
import { countFor, findPermanentOrNull, kw, powerOf, subtypesOf, toughnessOf } from "./permanents.js";
import { DAMAGE_EFFECTS } from "./handlers/damage.js";
import { LIBRARY_EFFECTS } from "./handlers/library.js";
import { MARVEL_EFFECTS } from "./handlers/marvel.js";
import { PERMANENT_EFFECTS } from "./handlers/permanents.js";
import type { EffectHandlers, EffectRun } from "./handlers/shared.js";
import { STACK_EFFECTS } from "./handlers/stack.js";
import { ZONE_EFFECTS } from "./handlers/zones.js";
import { SACRIFICE_EFFECTS } from "./handlers/sacrifice.js";
import { INFECT_EFFECTS } from "./handlers/infect.js";
import { GREEN_EFFECTS } from "./handlers/green.js";
import { STUN_EFFECTS } from "./handlers/stun.js";
import { THEME_EFFECTS } from "./handlers/theme.js";

// Running a spell's or ability's effects, one after another. What each kind of effect does is in handlers/.

const HANDLERS: Required<EffectHandlers> = { ...DAMAGE_EFFECTS, ...PERMANENT_EFFECTS, ...ZONE_EFFECTS, ...LIBRARY_EFFECTS, ...STACK_EFFECTS, ...MARVEL_EFFECTS, ...SACRIFICE_EFFECTS, ...INFECT_EFFECTS, ...GREEN_EFFECTS, ...STUN_EFFECTS, ...THEME_EFFECTS };

/** Runs a spell's or ability's effects in order. State-based actions are checked by the caller afterwards. */
export function runEffects(state: GameState, effects: Effect[], ctx: RunContext, events: GameEvent[]): void {
  const source = findPermanentOrNull(state, ctx.sourceId)?.perm;
  const trait = { name: ctx.sourceName, controller: ctx.controller, deathtouch: source ? kw(state, source, "deathtouch") : false, lifelink: source ? kw(state, source, "lifelink") : false, infect: source ? kw(state, source, "infect") : false, wither: source ? kw(state, source, "wither") : false, ...(source ? { perm: source } : {}) };
  const say = (text: string) => events.push({ type: "effect", text });
  const value = (amount: Amount): number => {
    if (amount === "X") return ctx.x ?? 0;
    if (typeof amount !== "object") return amount;
    const c = amount.count;
    if (c.kind === "x") return (ctx.x ?? 0) * (amount.times ?? 1);
    const self = findPermanentOrNull(state, ctx.sourceId)?.perm;
    const chosen = (iid?: string) => (iid ? findPermanentOrNull(state, iid)?.perm : undefined);
    const n =
      c.kind === "selfPower" ? (self ? Math.max(0, powerOf(state, self)) : 0)
      : c.kind === "selfCounters" ? (self?.counters ?? 0)
      : c.kind === "selfToughness" ? (self ? Math.max(0, toughnessOf(state, self)) : 0)
      : c.kind === "equipmentOnSelf" ? Object.values(state.players).flatMap((pl) => pl.battlefield).filter((p) => p.attachedTo === ctx.sourceId && subtypesOf(state, p).includes("equipment")).length
      : c.kind === "ifTargetSubtype" ? (() => {
          const t = ctx.targets[c.i];
          const p = t?.kind === "permanent" ? chosen(t.iid) : undefined;
          return p && (!c.notSelf || p.card.iid !== ctx.sourceId) && subtypesOf(state, p).includes(c.subtype) ? c.yes : c.no;
        })()
      : c.kind === "excessDamage" ? (state.lastExcess ?? 0)
      : c.kind === "targetPower" ? (() => {
          const t = ctx.targets[c.i];
          const p = t?.kind === "permanent" ? chosen(t.iid) : undefined;
          return p ? Math.max(0, powerOf(state, p)) : 0;
        })()
      : c.kind === "otherToughness" ? (() => {
          const p = chosen(ctx.other);
          return p ? Math.max(0, toughnessOf(state, p)) : 0;
        })()
      : c.kind === "ifOtherSubtype" ? (() => {
          const p = chosen(ctx.other);
          const types = p ? subtypesOf(state, p) : [];
          return types.includes(c.subtype) ? c.yes : c.no;
        })()
      : c.kind === "otherPower" ? (() => {
          const p = chosen(ctx.other);
          return p ? Math.max(0, powerOf(state, p)) : 0;
        })()
      : c.kind === "destroyedThisWay" ? Object.entries(ctx.destroyed ?? {}).reduce((sum, [who, k]) => sum + (!c.yours || who === ctx.controller ? (k ?? 0) : 0), 0)
      : countFor(state, ctx.controller, c, ctx.sourceId);
    return n * (amount.times ?? 1);
  };
  const preventRegen = effects.some((e) => e.type === "noRegen"); // "It can't be regenerated" is part of this spell
  // Remember who controls each target now, so "its controller" still works once it has been destroyed.
  if (!ctx.lki) {
    ctx.lki = {};
    for (const t of ctx.targets) if (t.kind === "permanent") {
      const found = findPermanentOrNull(state, t.iid);
      if (found) ctx.lki[t.iid] = found.owner.id;
    }
  }

  for (let step = 0; step < effects.length; step++) {
    if (state.pendingPick) break; // waiting for a choice: the effects that follow are saved with it and run afterwards
    const effect = effects[step];
    /** A choice among cards: the game waits, and the effects after this one run once it is answered. */
    const startPick = (pick: PendingPick) => {
      state.pendingPick = { ...pick, source: { iid: ctx.sourceId, name: ctx.sourceName, defId: ctx.sourceDefId }, ...(step + 1 < effects.length ? { rest: effects.slice(step + 1), ctx } : {}) };
    };
    const run: EffectRun = { state, ctx, events, trait, say, value, preventRegen, startPick, nested: (more) => runEffects(state, more, ctx, events) };
    (HANDLERS[effect.type] as (run: EffectRun, effect: Effect) => void)(run, effect);
  }
}
