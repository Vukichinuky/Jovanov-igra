/* PvP combat — deterministic, style-based.
   Every attack lands. The decision is which STYLE to use against this
   defender given your resources and their state.

   Knife (tier 0): cannot kill. One drain style.
   Melee (tier 1): three styles — Heavy / Quick / Disarm.
   Ranged (tier 2): three styles — Snap / Aimed / Maim (poison).
   Wizard mana (special tier 2): Bolt / Curse (mental).

   Defender state matters: low-fear targets are vulnerable to Feint/Curse,
   low-health targets to Heavy/Aimed. The attacker reads them and chooses. */

const MELEE_RANGE  = 1;
const RANGED_RANGE = 3;

/* Cost an attack pays. Caller must check feasibility before resolve(). */
function payCost(p, cost) {
  if (cost.sleep)  adjustStat(p, "sleep", -cost.sleep);
  if (cost.fear)   adjustStat(p, "fear",  -cost.fear);
  if (cost.mana)   adjustStat(p, "mana",  -cost.mana);
  if (cost.ammo) {
    p.ammo[cost.ammo.key] = Math.max(0, (p.ammo[cost.ammo.key] || 0) - cost.ammo.n);
  }
}
function canAfford(p, cost) {
  if (cost.sleep && p.sleep < cost.sleep) return false;
  if (cost.fear  && p.fear  < cost.fear)  return false;
  if (cost.mana  && p.mana  < cost.mana)  return false;
  // ammo is allowed to be 0 — the attempt becomes a bluff
  return true;
}
function costLabel(c) {
  const parts = [];
  if (c.sleep)        parts.push(`-${c.sleep} sleep`);
  if (c.fear)         parts.push(`-${c.fear} fear`);
  if (c.mana)         parts.push(`-${c.mana} mana`);
  if (c.ammo)         parts.push(`-${c.ammo.n} ${c.ammo.key}`);
  return parts.join(", ");
}

const Combat = {
  /* Targets in range of any weapon you carry. */
  validTargets(state, attacker) {
    if (!state.map) {
      return state.players.filter(p => p.alive && p.id !== attacker.id);
    }
    const hasMelee  = attacker.weapons.some(w => w.tier <= 1);
    const hasRanged = attacker.weapons.some(w => w.tier === 2) || attacker.classId === "wizard";
    const maxReach = hasRanged ? RANGED_RANGE : (hasMelee ? MELEE_RANGE : 0);
    return state.players.filter(p => {
      if (!p.alive || p.id === attacker.id) return false;
      return Grid.distance(attacker.position, p.position) <= maxReach;
    });
  },

  /* All concrete attack options against `defender`. Each option is a
     fully-described act: weapon, style, cost, deterministic outcome desc. */
  attackOptions(attacker, defender) {
    const dist = (typeof Grid !== "undefined" && attacker.position != null && defender && defender.position != null)
      ? Grid.distance(attacker.position, defender.position)
      : 0;

    const opts = [];

    for (const w of attacker.weapons) {
      if (w.tier === 0 && dist <= MELEE_RANGE) {
        opts.push({
          weapon: w, style: "intimidate",
          label: `Threaten with ${w.name} — drain (-1 sleep, -1 fear)`,
          cost: { sleep: 1, fear: 1 },
        });
      } else if (w.tier === 1 && dist <= MELEE_RANGE) {
        opts.push({
          weapon: w, style: "heavy",
          label: `Heavy ${w.name} — 6 dmg (-2 sleep, -1 fear)`,
          cost: { sleep: 2, fear: 1 },
        });
        opts.push({
          weapon: w, style: "quick",
          label: `Quick ${w.name} — 3 dmg (-1 sleep)`,
          cost: { sleep: 1 },
        });
        opts.push({
          weapon: w, style: "disarm",
          label: `Disarm with ${w.name} — 2 dmg, knock loose ammo (-1 sleep, -1 fear)`,
          cost: { sleep: 1, fear: 1 },
        });
      } else if (w.tier === 2 && dist <= RANGED_RANGE) {
        const have = attacker.ammo[w.ammo] || 0;
        const bluffSuffix = have <= 0 ? " — NO AMMO, bluff" : "";
        opts.push({
          weapon: w, style: "snap",
          label: `Snap shot ${w.name} — 4 dmg (-1 sleep, -1 ${w.ammo})${bluffSuffix}`,
          cost: { sleep: 1, ammo: { key: w.ammo, n: 1 } },
        });
        opts.push({
          weapon: w, style: "aimed",
          label: `Aimed shot ${w.name} — 6 dmg (-2 sleep, -1 ${w.ammo})${bluffSuffix}`,
          cost: { sleep: 2, ammo: { key: w.ammo, n: 1 } },
        });
        opts.push({
          weapon: w, style: "maim",
          label: `Maim shot ${w.name} — 3 dmg + poison 3t (-1 sleep, -1 fear, -1 ${w.ammo})${bluffSuffix}`,
          cost: { sleep: 1, fear: 1, ammo: { key: w.ammo, n: 1 } },
        });
      }
    }

    // Wizard spells — count as ranged.
    if (attacker.classId === "wizard" && dist <= RANGED_RANGE) {
      const mana = attacker.mana || 0;
      const dryHint = mana <= 0 ? " — NO MANA, fizzles" : "";
      opts.push({
        weapon: { id: "manabolt", name: "Mana Bolt", tier: 2, range: "ranged", ammo: "mana" },
        style: "bolt",
        label: `Mana Bolt — 5 dmg (-1 mana, -1 sleep)${dryHint}`,
        cost: { sleep: 1, mana: 1 },
      });
      opts.push({
        weapon: { id: "manacurse", name: "Mind Curse", tier: 2, range: "ranged", ammo: "mana" },
        style: "curse",
        label: `Mind Curse — drain mind (-2 mana, -1 fear) ${mana < 2 ? "— NOT ENOUGH MANA" : ""}`,
        cost: { sleep: 0, fear: 1, mana: 2 },
      });
    }

    // Filter out things you can't afford at all (and not even as a bluff).
    return opts.filter(o => {
      if (!canAfford(attacker, o.cost)) return false;
      // Mana attacks fizzle but still allowed if you have *some* mana,
      // not zero (already covered by canAfford).
      return true;
    });
  },

  /* Resolve a chosen option. Deterministic outcome. */
  resolve(state, attacker, defender, option) {
    const lines = [];
    const { weapon, style, cost } = option;

    // Detect bluffs BEFORE paying (ammo / mana check).
    let isBluff = false;
    if (cost.ammo) {
      const have = attacker.ammo[cost.ammo.key] || 0;
      isBluff = have < cost.ammo.n;
    } else if (style === "bolt" || style === "curse") {
      isBluff = (attacker.mana || 0) < (cost.mana || 0);
    }

    // Pay the cost.
    payCost(attacker, cost);
    // Defender always loses some fear from being attacked.
    adjustStat(defender, "fear", -1);

    /* ---- Knife: drain only ---- */
    if (style === "intimidate") {
      adjustStat(defender, "sleep", -2);
      adjustStat(defender, "fear", -2);
      lines.push({ text: `${attacker.name} pulls a knife on ${defender.name}.`, tone: "warn" });
      lines.push({ text: `${defender.name} backs off. -2 sleep, -2 fear.`, tone: "dim" });
      return { log: lines, killed: false };
    }

    /* ---- Melee ---- */
    if (style === "heavy") {
      const lost = -adjustStat(defender, "health", -6);
      lines.push({ text: `${attacker.name} brings ${weapon.name} down on ${defender.name}. -${lost} health.`, tone: "bad" });
      maybeKill(state, attacker, defender, lines);
      return { log: lines, killed: !defender.alive };
    }
    if (style === "quick") {
      const lost = -adjustStat(defender, "health", -3);
      lines.push({ text: `${attacker.name} cuts ${defender.name} with ${weapon.name}. -${lost} health.`, tone: "bad" });
      maybeKill(state, attacker, defender, lines);
      return { log: lines, killed: !defender.alive };
    }
    if (style === "disarm") {
      const lost = -adjustStat(defender, "health", -2);
      // Drop some loose ammo
      const ammoKeys = Object.keys(defender.ammo).filter(k => (defender.ammo[k] || 0) > 0);
      if (ammoKeys.length > 0) {
        const k = RNG.pick(ammoKeys);
        const drop = Math.min(2, defender.ammo[k]);
        defender.ammo[k] -= drop;
        lines.push({ text: `${attacker.name} batters ${defender.name}'s pack. -${lost} health, ${drop} ${k} lost.`, tone: "bad" });
      } else {
        lines.push({ text: `${attacker.name} batters ${defender.name}. -${lost} health.`, tone: "bad" });
      }
      maybeKill(state, attacker, defender, lines);
      return { log: lines, killed: !defender.alive };
    }

    /* ---- Ranged ---- */
    if (style === "snap" || style === "aimed" || style === "maim") {
      if (isBluff) {
        lines.push({ text: `${attacker.name} raises ${weapon.name} at ${defender.name}.`, tone: "warn" });
        lines.push({ text: `A dry click. ${defender.name} loses 1 more fear.`, tone: "dim" });
        adjustStat(defender, "fear", -1);
        return { log: lines, killed: false };
      }
      const dmg = style === "snap" ? 4 : style === "aimed" ? 6 : 3;
      const lost = -adjustStat(defender, "health", -dmg);
      lines.push({ text: `${attacker.name} fires ${weapon.name} at ${defender.name}. -${lost} health.`, tone: "bad" });
      if (style === "maim") {
        defender.conditions = defender.conditions || { poison: 0 };
        defender.conditions.poison = Math.max(defender.conditions.poison || 0, 3);
        lines.push({ text: `The bolt was tipped. ${defender.name} is poisoned (3 turns).`, tone: "bad" });
      }
      maybeKill(state, attacker, defender, lines);
      return { log: lines, killed: !defender.alive };
    }

    /* ---- Wizard ---- */
    if (style === "bolt") {
      if (isBluff) {
        lines.push({ text: `${attacker.name} raises a hand. Nothing comes.`, tone: "dim" });
        return { log: lines, killed: false };
      }
      const lost = -adjustStat(defender, "health", -5);
      lines.push({ text: `A bolt of dark light strikes ${defender.name}. -${lost} health.`, tone: "bad" });
      maybeKill(state, attacker, defender, lines);
      return { log: lines, killed: !defender.alive };
    }
    if (style === "curse") {
      if (isBluff) {
        lines.push({ text: `${attacker.name} whispers. The wood does not answer.`, tone: "dim" });
        return { log: lines, killed: false };
      }
      adjustStat(defender, "fear", -5);
      adjustStat(defender, "sleep", -3);
      lines.push({ text: `${attacker.name} whispers into the air around ${defender.name}.`, tone: "warn" });
      lines.push({ text: `${defender.name}'s mind buckles. -5 fear, -3 sleep.`, tone: "bad" });
      maybeKill(state, attacker, defender, lines);
      return { log: lines, killed: !defender.alive };
    }

    return { log: [{ text: "Nothing happens.", tone: "dim" }], killed: false };
  },
};

function maybeKill(state, attacker, defender, lines) {
  if (defender.health <= 0 && defender.alive) {
    defender.alive = false;
    defender.killedBy = attacker.id;
    defender.ghost = Ghosts.create(defender, attacker);
    attacker.betrayed = attacker.betrayed || [];
    attacker.betrayed.push(defender.id);
    lines.push({ text: `${defender.name} falls.`, tone: "ghost" });
  }
}
