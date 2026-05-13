/* Ghost system.
   When a player dies, they get a ghost. Every round after their death,
   the ghost takes one of three actions (or skips). Ghost is invisible:
   the living see effects, not the source. */

const Ghosts = {
  create(deadPlayer, killer) {
    return {
      ownerId: deadPlayer.id,
      ownerName: deadPlayer.name,
      killerId: killer ? killer.id : null, // may be null for non-PvP deaths (madness)
      // weight bonus toward killer / betrayer
      grudges: killer ? [killer.id] : [],
      bornRound: null, // set on first ghost turn (one round of rest before acting)
    };
  },

  // Action menu shown when this ghost's turn comes up.
  actionsFor(state, ghost) {
    // Skip warded players entirely.
    const targetable = state.players.filter(p => p.alive && !(p.conditions && p.conditions.wardTurns > 0));
    if (targetable.length === 0) return [];

    const opts = [];

    for (const target of targetable) {
      opts.push({
        kind: "whisper",
        label: `Whisper at ${target.name} (their fear -1)`,
        targetId: target.id,
        execute(state) {
          adjustStat(target, "fear", -1);
          state.log.unshift({ text: `${target.name} hears something they shouldn't. Fear -1.`, tone: "ghost" });
        }
      });
    }
    for (const target of targetable) {
      opts.push({
        kind: "sour",
        label: `Sour ${target.name}'s next path`,
        targetId: target.id,
        execute(state) {
          state.flags.souredFor = target.id;
          state.log.unshift({ text: `Something has gone wrong for ${target.name}. They don't know yet.`, tone: "ghost" });
        }
      });
    }
    for (const target of targetable) {
      opts.push({
        kind: "disturb",
        label: `Disturb ${target.name}'s rest`,
        targetId: target.id,
        execute(state) {
          state.flags.disturbedRestFor = target.id;
          state.log.unshift({ text: `${target.name} will not rest easy.`, tone: "ghost" });
        }
      });
    }

    return opts;
  },
};
