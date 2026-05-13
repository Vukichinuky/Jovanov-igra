/* Exploration deck for the Forest zone (MVP).
   Each card has:
     id, kind, title, body (flavor), weight (draw frequency),
     resolve(state, player) -> { log: [{text, tone}], options?: [...] }
   Some cards present a CHOICE — resolve returns options the player picks
   from. Others resolve immediately. */

const CARDS = [

  // --- Neutral / quiet ---
  {
    id: "empty_clearing",
    kind: "Quiet",
    title: "An empty clearing",
    body: "Wet moss. No tracks. The air sits still on your skin.",
    weight: 3,
    resolve(state, p) {
      return { log: [{ text: `${p.name} finds nothing.`, tone: "dim" }] };
    }
  },
  {
    id: "still_water",
    kind: "Quiet",
    title: "A still pool of water",
    body: "It does not ripple when you breathe. You drink anyway.",
    weight: 2,
    resolve(state, p) {
      const slept = adjustStat(p, "sleep", +1);
      const fearBack = adjustStat(p, "fear", +1);
      const parts = [];
      if (slept > 0)   parts.push(`Sleep +${slept}`);
      if (fearBack > 0) parts.push(`Fear +${fearBack}`);
      const tail = parts.length ? `. ${parts.join(", ")}` : ". The water was already in you.";
      return { log: [{
        text: `${p.name} drinks${tail}.`,
        tone: "good"
      }] };
    }
  },
  {
    id: "old_path",
    kind: "Quiet",
    title: "An old path",
    body: "Boot prints, dried hard. Someone walked here a while ago. Or it was you.",
    weight: 2,
    resolve(state, p) {
      adjustStat(p, "sleep", -1);
      return { log: [{ text: `${p.name} walks the path. Sleep -1.`, tone: "dim" }] };
    }
  },

  // --- Hostile fauna ---
  {
    id: "wild_boar",
    kind: "Threat",
    title: "A wild boar",
    body: "Its eyes are too small for the body behind them.",
    weight: 2,
    resolve(state, p) {
      const fearCut = (CLASSES[p.classId].hooks.animalFearReduction || 0);
      const hit = applyInjury(p, 2);
      const fearLoss = Math.max(0, 1 - fearCut);
      adjustStat(p, "fear", -fearLoss);
      const tail = fearLoss > 0 ? `, ${fearLoss} fear` : "";
      return { log: [
        { text: `The boar charges. ${p.name} loses ${hit} health${tail}.`, tone: "bad" }
      ] };
    }
  },
  {
    id: "snake",
    kind: "Threat",
    title: "A snake in the grass",
    body: "You see it after it sees you.",
    weight: 2,
    resolve(state, p) {
      const hit = applyInjury(p, 1);
      // hidden poison: 50% chance to also lose 1 sleep next turn
      if (RNG.chance(0.5)) {
        p.secrets.push({ tag: "poisoned", text: "Something burns in the wound. (-1 sleep next turn)" });
      }
      return { log: [
        { text: `It strikes. ${p.name} loses ${hit} health.`, tone: "bad" }
      ] };
    }
  },
  {
    id: "wolves",
    kind: "Threat",
    title: "Wolves in the dark",
    body: "Not one. Several. They do not approach.",
    weight: 1,
    resolve(state, p) {
      const fearCut = (CLASSES[p.classId].hooks.animalFearReduction || 0);
      const fearLoss = Math.max(0, 2 - fearCut);
      adjustStat(p, "fear", -fearLoss);
      adjustStat(p, "sleep", -1);
      const tail = fearLoss > 0 ? `Fear -${fearLoss}, ` : "";
      return { log: [
        { text: `${p.name} backs away slowly. ${tail}Sleep -1.`, tone: "bad" }
      ] };
    }
  },

  // --- Mental ---
  {
    id: "whisper",
    kind: "Eerie",
    title: "A whisper that knows your name",
    body: "It is not in a language you know. You understand it anyway.",
    weight: 2,
    resolve(state, p) {
      const extra = (CLASSES[p.classId].hooks.extraFearOnEerie || 0);
      const cut = adjustStat(p, "fear", -(1 + extra));
      return { log: [
        { text: `${p.name} hears the whisper. Fear ${cut}.`, tone: "bad" }
      ] };
    }
  },
  {
    id: "shape_at_treeline",
    kind: "Eerie",
    title: "A shape at the treeline",
    body: "When you look directly at it, it is a tree.",
    weight: 2,
    resolve(state, p) {
      const extra = (CLASSES[p.classId].hooks.extraFearOnEerie || 0);
      adjustStat(p, "fear", -(1 + extra));
      adjustStat(p, "sleep", -1);
      return { log: [
        { text: `${p.name} watches the treeline too long. Fear -${1 + extra}, Sleep -1.`, tone: "bad" }
      ] };
    }
  },
  {
    id: "lost_trail",
    kind: "Eerie",
    title: "The trail loops back",
    body: "You walk for an hour and arrive where you started. You did not turn.",
    weight: 1,
    resolve(state, p) {
      adjustStat(p, "sleep", -2);
      return { log: [
        { text: `${p.name} loses an hour. Sleep -2.`, tone: "bad" }
      ] };
    }
  },

  // --- Rewards (often with a catch) ---
  {
    id: "chest",
    kind: "Find",
    title: "A buried chest",
    body: "The wood is rotten where you've cut. Inside, you can almost see something.",
    weight: 2,
    resolve(state, p) {
      // Decision: open it now (risk) or leave it
      return {
        log: [{ text: `${p.name} finds a chest.`, tone: "good" }],
        options: [
          { label: "Force it open (-1 sleep)", action: () => openChest(state, p) },
          { label: "Leave it. Walk away.", action: () => ({ log: [{ text: `${p.name} leaves the chest.`, tone: "dim" }] }) }
        ]
      };
    }
  },
  {
    id: "hidden_cache",
    kind: "Find",
    title: "A cache between stones",
    body: "Tucked, deliberate. Someone meant to come back for this.",
    weight: 1,
    resolve(state, p) {
      const drops = [
        { tag: "bolts", n: RNG.range(1, 2), text: "crossbow bolts" },
        { tag: "bullets", n: RNG.range(1, 1), text: "bullets" },
        { tag: "bolts", n: 1, text: "a single bolt" },
      ];
      const drop = RNG.pick(drops);
      p.ammo[drop.tag] = (p.ammo[drop.tag] || 0) + drop.n;
      p.secrets.push({ tag: "ammo_found", text: `You took ${drop.n} ${drop.text}. The others did not see.` });
      return { log: [
        { text: `${p.name} finds a small cache. Something useful, hidden.`, tone: "good" }
      ] };
    }
  },
  {
    id: "ruins_npc",
    kind: "Find",
    title: "A wanderer at a ruin",
    body: "He smiles like he was waiting. He probably wasn't.",
    weight: 2,
    resolve(state, p) {
      return {
        log: [{ text: `${p.name} meets a wanderer.`, tone: "warn" }],
        options: [
          {
            label: "Trade: -2 sleep for 1 bolt",
            action: () => {
              if (p.sleep < 2) return { log: [{ text: `${p.name} is too tired to bargain.`, tone: "bad" }] };
              adjustStat(p, "sleep", -2);
              p.ammo.bolts += 1;
              return { log: [{ text: `${p.name} trades sleep for a bolt.`, tone: "good" }] };
            }
          },
          {
            label: "Ask after the artefact (-1 fear)",
            action: () => {
              adjustStat(p, "fear", -1);
              // 40% chance the wanderer points you to one
              if (RNG.chance(0.4)) {
                p.secrets.push({ tag: "rumor", text: "The wanderer drew a map. Your next exploration card may be an artefact fragment." });
                state.flags.rangerNextCardForce = { playerId: p.id, cardId: "artefact_fragment" };
                return { log: [{ text: `He whispers something true.`, tone: "good" }] };
              }
              return { log: [{ text: `He whispers something. You don't know if it was true.`, tone: "dim" }] };
            }
          },
          {
            label: "Walk past him.",
            action: () => ({ log: [{ text: `${p.name} walks past.`, tone: "dim" }] })
          }
        ]
      };
    }
  },
  {
    id: "ghost_sighting",
    kind: "Eerie",
    title: "Someone you knew",
    body: "Standing among the trees. They do not move when you do.",
    weight: 1,
    resolve(state, p) {
      // Only chilling if there are dead players. Otherwise just unsettling.
      const dead = state.players.filter(x => !x.alive);
      if (dead.length > 0) {
        const who = RNG.pick(dead);
        adjustStat(p, "fear", -2);
        return { log: [
          { text: `${p.name} sees ${who.name} between the trees. Fear -2.`, tone: "ghost" }
        ] };
      }
      adjustStat(p, "fear", -1);
      return { log: [
        { text: `${p.name} sees someone they could almost name. Fear -1.`, tone: "ghost" }
      ] };
    }
  },
  {
    id: "artefact_fragment",
    kind: "Artefact",
    title: "An artefact fragment",
    body: "Cold metal. Older than the wood. It does not want to be held.",
    weight: 1,
    resolve(state, p) {
      p.artefacts += 1;
      adjustStat(p, "fear", -1);
      return { log: [
        { text: `${p.name} takes an artefact fragment. Total: ${p.artefacts}. Fear -1.`, tone: "good" }
      ] };
    }
  },
];

/* ------------ helpers ------------ */

function adjustStat(p, key, delta) {
  const max = p.maxes[key];
  const before = p[key];
  let next = before + delta;
  if (next < 0) next = 0;
  if (next > max) next = max;
  p[key] = next;
  return next - before; // signed delta actually applied
}

function applyInjury(p, raw) {
  const hook = CLASSES[p.classId].hooks.mitigateInjury;
  const amt = hook ? hook(raw) : raw;
  return -adjustStat(p, "health", -amt); // returns positive amount lost
}

function openChest(state, p) {
  // Pay cost
  adjustStat(p, "sleep", -1);

  // Roll for outcome
  const bonus = CLASSES[p.classId].hooks.chestBadRollBonus || 0;
  const roll = RNG.int(10) + bonus;

  if (roll <= 1) {
    // Snake. Bad.
    const hit = applyInjury(p, 2);
    return { log: [{ text: `A snake. ${p.name} loses ${hit} health.`, tone: "bad" }] };
  }
  if (roll <= 3) {
    // Curse: lose 2 fear, sleep
    adjustStat(p, "fear", -2);
    return { log: [{ text: `Bones and a coin that bites. Fear -2.`, tone: "bad" }] };
  }
  if (roll <= 6) {
    // Ammo
    const which = RNG.chance(0.5) ? "bolts" : "bullets";
    const n = RNG.range(1, 2);
    p.ammo[which] += n;
    p.secrets.push({ tag: "chest_ammo", text: `You pocketed ${n} ${which}.` });
    return { log: [{ text: `${p.name} pries it open. They keep what they found to themselves.`, tone: "good" }] };
  }
  if (roll <= 8) {
    // Tier 1 melee weapon
    if (!p.weapons.find(w => w.id === "axe")) {
      p.weapons.push({ id: "axe", name: "Forester's Axe", tier: 1, range: "melee", ammo: null });
      return { log: [{ text: `${p.name} pulls out an axe. Old. Heavy. Real.`, tone: "good" }] };
    }
    p.ammo.bolts += 2;
    return { log: [{ text: `${p.name} pries it open. Bolts. Two of them.`, tone: "good" }] };
  }
  // Tier 2 ranged
  if (RNG.chance(0.5) && !p.weapons.find(w => w.id === "crossbow")) {
    p.weapons.push({ id: "crossbow", name: "Crossbow", tier: 2, range: "ranged", ammo: "bolts" });
    p.ammo.bolts += 1;
    return { log: [{ text: `${p.name} pulls out a crossbow. One bolt with it.`, tone: "good" }] };
  }
  if (!p.weapons.find(w => w.id === "pistol")) {
    p.weapons.push({ id: "pistol", name: "Old Pistol", tier: 2, range: "ranged", ammo: "bullets" });
    p.ammo.bullets += 1;
    return { log: [{ text: `${p.name} pulls out a pistol. One bullet with it.`, tone: "good" }] };
  }
  // already had everything — just ammo
  p.ammo.bolts += 1;
  p.ammo.bullets += 1;
  return { log: [{ text: `${p.name} pries it open. A little ammunition.`, tone: "good" }] };
}

/* ------------ deck ops ------------ */
const Deck = {
  build() {
    const arr = [];
    for (const c of CARDS) {
      for (let i = 0; i < c.weight; i++) arr.push(c.id);
    }
    return RNG.shuffle(arr);
  },
  draw(state, p) {
    // Honor forced cards (set by ruins NPC rumor or ranger trap)
    if (state.flags.rangerNextCardForce && state.flags.rangerNextCardForce.playerId === p.id) {
      const forcedId = state.flags.rangerNextCardForce.cardId;
      state.flags.rangerNextCardForce = null;
      return CARDS.find(c => c.id === forcedId);
    }
    if (state.deck.length === 0) state.deck = Deck.build();
    const id = state.deck.pop();
    return CARDS.find(c => c.id === id);
  }
};
