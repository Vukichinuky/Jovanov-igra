/* PvP combat. Every attack costs both sides something.
   Tier 0 (knife): cannot kill. Drains.
   Tier 1 (melee): can kill, but only if target health <= 2.
   Tier 2 (ranged): can kill if loaded; ammo is consumed.

   Bluffing matters because other players see WHAT weapon you brandish
   but not WHETHER it's loaded. */

const Combat = {
  // List who you can attack right now. In MVP everyone is "in the same wood",
  // so any living player except self is a valid target.
  validTargets(state, attacker) {
    return state.players.filter(p => p.alive && p.id !== attacker.id);
  },

  // What attack options does the attacker actually have?
  // We expose the weapon name to the defender via the log so bluffs work.
  attackOptions(attacker) {
    const opts = [];
    for (const w of attacker.weapons) {
      if (w.tier === 0) {
        opts.push({
          weapon: w,
          label: `Threaten with ${w.name} (can't kill)`,
        });
      } else if (w.tier === 1) {
        opts.push({
          weapon: w,
          label: `Swing ${w.name}`,
        });
      } else if (w.tier === 2) {
        const have = attacker.ammo[w.ammo] || 0;
        opts.push({
          weapon: w,
          label: `Fire ${w.name}${have > 0 ? "" : " (no ammo — bluff)"}`,
        });
      }
    }
    // Wizard can also fire a mana bolt (no ammo, costs mana)
    if (attacker.classId === "wizard") {
      const haveMana = attacker.mana > 0;
      opts.push({
        weapon: { id: "manabolt", name: "Mana Bolt", tier: 2, range: "ranged", ammo: "mana" },
        label: `Cast Mana Bolt${haveMana ? "" : " (no mana — fizzle)"}`,
      });
    }
    return opts;
  },

  // Execute the chosen attack.
  // Returns { log: [...], killed: boolean }.
  resolve(state, attacker, defender, weapon) {
    const lines = [];
    let killed = false;

    // Universal cost to attack: 1 sleep, 1 fear from attacker
    adjustStat(attacker, "sleep", -1);
    adjustStat(attacker, "fear", -1);
    // Defender always loses 1 fear from being attacked
    adjustStat(defender, "fear", -1);

    if (weapon.id === "knife" || weapon.tier === 0) {
      // Cannot kill. Drains both sides; reduces defender's sleep.
      adjustStat(defender, "sleep", -1);
      adjustStat(defender, "fear", -1);
      lines.push({ text: `${attacker.name} pulls a knife on ${defender.name}.`, tone: "warn" });
      lines.push({ text: `Both lose sleep and nerve. No blood.`, tone: "dim" });
      return { log: lines, killed: false };
    }

    if (weapon.tier === 1) {
      // Hit chance: 65%
      const hit = RNG.chance(0.65);
      lines.push({ text: `${attacker.name} swings ${weapon.name} at ${defender.name}.`, tone: "warn" });
      if (!hit) {
        lines.push({ text: `It glances off the dark.`, tone: "dim" });
        return { log: lines, killed: false };
      }
      const dmg = 2;
      const lost = -adjustStat(defender, "health", -dmg);
      lines.push({ text: `It bites. ${defender.name} loses ${lost} health.`, tone: "bad" });
      if (defender.health <= 0) {
        killed = true;
        recordKill(state, attacker, defender);
        lines.push({ text: `${defender.name} falls.`, tone: "ghost" });
      }
      return { log: lines, killed };
    }

    if (weapon.tier === 2) {
      // Ranged. Mana bolt for wizard uses mana; others use bolts/bullets.
      const ammoKey = weapon.ammo;
      const have = ammoKey === "mana" ? attacker.mana : (attacker.ammo[ammoKey] || 0);

      if (have <= 0) {
        // BLUFF — weapon was empty
        lines.push({ text: `${attacker.name} raises ${weapon.name} at ${defender.name}.`, tone: "warn" });
        lines.push({ text: `A dry click. Nothing.`, tone: "dim" });
        // Both lose extra fear from the moment
        adjustStat(defender, "fear", -1);
        adjustStat(attacker, "fear", -1);
        return { log: lines, killed: false };
      }

      // Consume ammo
      if (ammoKey === "mana") attacker.mana -= 1;
      else attacker.ammo[ammoKey] -= 1;

      // Hit chance
      let pHit = 0.7;
      pHit += CLASSES[attacker.classId].hooks.rangedHitBonus || 0;

      lines.push({ text: `${attacker.name} fires ${weapon.name} at ${defender.name}.`, tone: "warn" });
      const hit = RNG.chance(pHit);
      if (!hit) {
        lines.push({ text: `It misses. The bolt is gone.`, tone: "dim" });
        return { log: lines, killed: false };
      }

      const dmg = 3;
      const lost = -adjustStat(defender, "health", -dmg);
      lines.push({ text: `Direct. ${defender.name} loses ${lost} health.`, tone: "bad" });
      if (defender.health <= 0) {
        killed = true;
        recordKill(state, attacker, defender);
        lines.push({ text: `${defender.name} falls.`, tone: "ghost" });
      }
      return { log: lines, killed };
    }

    return { log: [{ text: `Nothing happens.`, tone: "dim" }], killed: false };
  }
};

function recordKill(state, attacker, defender) {
  defender.alive = false;
  defender.killedBy = attacker.id;
  defender.ghost = Ghosts.create(defender, attacker);
  attacker.betrayed = attacker.betrayed || [];
  attacker.betrayed.push(defender.id);
}
