/* Character classes. Asymmetric — each one bends the rules in a different
   place rather than just having different stats. */

const CLASSES = {
  dwarf: {
    id: "dwarf",
    name: "Dwarf",
    blurb: "Heavy. Slow to break.",
    base: { health: 6, sleep: 5, fear: 5, mana: 0 },
    maxes: { health: 6, sleep: 5, fear: 5, mana: 0 },
    traits: [
      "Body of stone — resists 1 health on most exploration injuries.",
      "Reads ruins better — chest mishaps are reduced.",
      "No mana. No spells."
    ],
    // hooks consumed by other modules
    hooks: {
      mitigateInjury: (amt) => Math.max(0, amt - 1),
      chestBadRollBonus: 1, // adds to roll when opening, raising chance of good outcome
    }
  },

  wizard: {
    id: "wizard",
    name: "Wizard",
    blurb: "Fragile. Sees too much.",
    base: { health: 4, sleep: 5, fear: 5, mana: 3 },
    maxes: { health: 4, sleep: 5, fear: 5, mana: 5 },
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
    base: { health: 5, sleep: 5, fear: 6, mana: 0 },
    maxes: { health: 5, sleep: 5, fear: 6, mana: 0 },
    traits: [
      "Lower fear from animals and the forest itself.",
      "May plant a trap on the next exploration card drawn by anyone (costs 1 sleep).",
      "Aims true — ranged attacks have +1 chance to hit."
    ],
    hooks: {
      animalFearReduction: 1,
      rangedHitBonus: 0.15
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

    // hidden secrets known only when this player is active
    secrets: [],     // free-form notes ("there is a snake at the next clearing", etc.)
    artefacts: 0,

    // social tracking
    deals: [],       // active deals (informal)
    betrayed: [],    // player ids this player has betrayed
    killedBy: null,  // player id, if applicable

    // ghost state (filled when player dies)
    ghost: null,
  };
}
