/* Character classes. Asymmetric — each one bends the rules in a different
   place rather than just having different stats. */

const CLASSES = {
  dwarf: {
    id: "dwarf",
    name: "Dwarf",
    blurb: "Heavy. Slow to break.",
    base: { health: 12, sleep: 10, fear: 10, mana: 0 },
    maxes: { health: 12, sleep: 10, fear: 10, mana: 0 },
    traits: [
      "Body of stone — resists 1 health on most exploration injuries.",
      "Reads ruins better — chest mishaps are reduced.",
      "No mana. No spells."
    ],
    hooks: {
      mitigateInjury: (amt) => Math.max(0, amt - 1),
      chestBadRollBonus: 1,
    }
  },

  wizard: {
    id: "wizard",
    name: "Wizard",
    blurb: "Fragile. Sees too much.",
    base: { health: 8, sleep: 10, fear: 10, mana: 6 },
    maxes: { health: 8, sleep: 10, fear: 10, mana: 8 },
    traits: [
      "Spends mana to attack at range without ammo.",
      "Loses 1 extra fear on ghost or whisper events.",
      "Can attempt to read another player's last drawn card (costs 1 mana, 1 fear)."
    ],
    hooks: {
      extraFearOnEerie: 1
    }
  },

  ranger: {
    id: "ranger",
    name: "Ranger",
    blurb: "Quiet. Watching.",
    base: { health: 10, sleep: 10, fear: 12, mana: 0 },
    maxes: { health: 10, sleep: 10, fear: 12, mana: 0 },
    traits: [
      "Lower fear from animals and the forest itself.",
      "May plant a trap on a neighbor tile (costs 2 sleep).",
      "Aims true — ranged attacks have +1 chance to hit.",
      "Eyes through fog — sees one tile further than most."
    ],
    hooks: {
      animalFearReduction: 1,
      rangedHitBonus: 0.15,
    }
  },
};

function makePlayer({ id, name, classId, isHuman = true }) {
  const cls = CLASSES[classId];
  return {
    id,
    name: name || cls.name,
    classId,
    isHuman,
    alive: true,

    // resources
    health: cls.base.health,
    sleep:  cls.base.sleep,
    fear:   cls.base.fear,
    mana:   cls.base.mana,
    maxes:  { ...cls.maxes },

    // inventory
    weapons: [{ id: "knife", name: "Knife", tier: 0, range: "melee", ammo: null }],
    activeWeaponIdx: 0,
    ammo: { bolts: 0, bullets: 0 },

    // position on the hex map; set during Game.start
    position: null,
    revealedTiles: new Set(),
    peekedTiles: new Set(),     // tiles you've sensed-at-distance (kind known)
    knownPositions: {},   // { otherId: { tile, round } } — last sighted by THIS player
    scanActiveThisRound: false,  // true the round you used Scan (reveals all)

    // active condition timers
    conditions: { poison: 0, wardTurns: 0 },

    // permanent character bonuses (from shrines etc.)
    damageBonus: 0,

    // hidden secrets known only when this player is active
    secrets: [],
    artefacts: 0,

    // social tracking
    deals: [],       // active deals (informal)
    betrayed: [],    // player ids this player has betrayed
    killedBy: null,  // player id, if applicable

    // ghost state (filled when player dies)
    ghost: null,
  };
}
