/* The Quiet Wood — main state machine.
   State phases:
     "setup"       — choose players & classes
     "privacy"     — pass the device
     "play"        — active player's turn
     "ghost"       — a dead player's ghost acts
     "end"         — game over

   Turn flow per round:
     For each living player (in seat order):
       privacy screen -> play turn (one main action) -> end-of-turn checks
     For each dead player with a ghost (born before this round):
       privacy screen -> ghost picks one action (or skip)
     -> next round
*/

const Game = (() => {
  const ROUND_TOTAL = 15;
  const ARTEFACTS_TO_WIN = 2;
  const BASE_SIGHT = 2;  // distance you naturally sense other players
  const RING_EVERY = 3;  // rounds between each ring closure
  const MAX_DARK_RINGS = 5;

  const state = {
    phase: "setup",
    round: 1,
    players: [],
    seatOrder: [],
    turnIdx: 0,
    ghostQueue: [],
    activeId: null,
    deck: [],
    log: [],
    flags: {
      souredFor: null,
      disturbedRestFor: null,
      rangerNextCardForce: null,
    },
    lastDrawn: {},
    darkRings: 0,           // outer rings of tiles that have gone dark
  };

  function start({ seed, players }) {
    RNG.seed(seed);
    state.phase = "play";
    state.round = 1;
    state.players = players;
    state.seatOrder = players.map(p => p.id);
    state.turnIdx = 0;
    state.deck = Deck.build();
    state.log = [];
    state.flags = { souredFor: null, disturbedRestFor: null, rangerNextCardForce: null };
    state.lastDrawn = {};
    state.darkRings = 0;

    // Build the hex map and place each player at their start tile.
    state.map = Grid.build(players.length);
    for (let i = 0; i < players.length; i++) {
      players[i].position = state.map.playerStarts[i];
      players[i].revealedTiles = new Set([players[i].position]);
    }

    state.activeId = state.seatOrder[0];
    logLine("The wood breathes around you. Round 1 begins.", "dim");
    UI.toPrivacy(currentPlayer());
  }

  function currentPlayer() {
    return state.players.find(p => p.id === state.activeId);
  }

  function logLine(text, tone = "") {
    state.log.unshift({ text, tone });
  }
  // expose to other modules
  window._logLine = logLine;

  /* How far this player can sense others naturally. */
  function sightRange(p) {
    const bonus = (CLASSES[p.classId].hooks.sightBonus || 0);
    return BASE_SIGHT + bonus;
  }

  /* Does this player currently know where `other` is? */
  function canSee(viewer, other) {
    if (!other.alive) return true; // ghosts visible via dim corpses
    if (viewer.scanActiveThisRound) return true;
    if (!state.map) return true;
    return Grid.distance(viewer.position, other.position) <= sightRange(viewer);
  }

  /* Update viewer's memory of who they can see right now. */
  function updateSightFor(viewer) {
    viewer.knownPositions = viewer.knownPositions || {};
    for (const other of state.players) {
      if (other.id === viewer.id) continue;
      if (!other.alive) continue;
      if (canSee(viewer, other)) {
        viewer.knownPositions[other.id] = { tile: other.position, round: state.round };
      }
    }
  }

  /* Apply ongoing conditions at the start of a player's turn. */
  function applyStartOfTurnEffects(p) {
    if (!p.conditions) p.conditions = { poison: 0, wardTurns: 0 };
    if (p.conditions.poison > 0) {
      const hit = -adjustStat(p, "health", -1);
      p.conditions.poison -= 1;
      const left = p.conditions.poison;
      logLine(`The poison works on ${p.name}. -${hit} health.` + (left > 0 ? ` (${left} turn${left>1?"s":""} left)` : " (fades)"), "bad");
    }
    if (p.conditions.wardTurns > 0) {
      p.conditions.wardTurns -= 1;
      if (p.conditions.wardTurns === 0) {
        logLine(`The salt around ${p.name} thins to nothing.`, "ghost");
      }
    }
    // Wizards passively regenerate 1 mana each turn.
    if (p.classId === "wizard") {
      const m = adjustStat(p, "mana", +1);
      if (m > 0) logLine(`${p.name} draws breath. Mana +${m}.`, "good");
    }
    // Anyone standing on a river starts the turn with +1 health (slow heal).
    if (state.map) {
      const tile = state.map.tiles[p.position];
      if (tile && tile.biome === "river") {
        const h = adjustStat(p, "health", +1);
        if (h > 0) logLine(`The river is cold on ${p.name}'s skin. Health +${h}.`, "good");
        if (p.classId === "wizard") {
          const m = adjustStat(p, "mana", +1);
          if (m > 0) logLine(`The river sings. Mana +${m}.`, "good");
        }
      }
    }
  }

  /* Extend peeked tiles based on this player's sight (kind known, content hidden). */
  function refreshPeek(p) {
    if (!state.map) return;
    p.peekedTiles = p.peekedTiles || new Set();
    const r = sightRange(p);
    // BFS within radius r
    const visited = new Set([p.position]);
    let frontier = [p.position];
    for (let d = 0; d < r; d++) {
      const next = [];
      for (const t of frontier) {
        for (const n of Grid.neighbors(t)) {
          if (visited.has(n)) continue;
          visited.add(n);
          next.push(n);
        }
      }
      frontier = next;
    }
    for (const t of visited) p.peekedTiles.add(t);
  }

  /* Called by UI when the active player's turn actually starts (after the
     privacy screen). Applies pending effects and refreshes sight. */
  function beginActiveTurn() {
    const p = currentPlayer();
    if (!p) return;

    p.scanActiveThisRound = false;

    // If the fog rolled in and is now on you, the dark eats and pushes inward.
    if (state.map && Grid.isDark(p.position, state.darkRings)) {
      const hit = -adjustStat(p, "health", -3);
      adjustStat(p, "fear", -2);
      logLine(`The dark closes over ${p.name}. -${hit} health, -2 fear.`, "ghost");
      // Force-relocate to a random safe neighbor (or an interior tile).
      const safeNeighbor = Grid.neighbors(p.position).find(n => !Grid.isDark(n, state.darkRings));
      const dest = safeNeighbor != null ? safeNeighbor : Grid.randomInteriorTile(state.darkRings);
      p.position = dest;
      p.revealedTiles.add(dest);
      logLine(`${p.name} stumbles inward to tile #${dest}.`, "dim");
    }

    applyStartOfTurnEffects(p);
    if (p.alive && p.health <= 0) {
      p.alive = false;
      p.ghost = Ghosts.create(p, null);
      logLine(`${p.name} dies of the wound.`, "ghost");
      return advance();
    }
    updateSightFor(p);
    refreshPeek(p);
  }

  /* ------- Turn actions available to the active player ------- */
  function availableActions(p) {
    const actions = [
      { id: "move",    label: "Move 1 tile (sleep cost varies by terrain)", enabled: p.sleep >= 1 },
      { id: "rest",    label: "Rest (+2 sleep, +1 fear, +1 health)", enabled: p.fear > 0 || p.health < p.maxes.health },
      { id: "scan",    label: "Scan the wood (-2 fear)",       enabled: p.fear >= 2 },
      { id: "treat",   label: (p.conditions && p.conditions.poison > 0) ? "Treat wound (-2 sleep, clear poison)" : "Treat wound (-2 sleep, +3 health)", enabled: p.sleep >= 2 && (p.conditions.poison > 0 || p.health < p.maxes.health) },
    ];

    if (Combat.validTargets(state, p).length > 0) {
      actions.push({ id: "attack", label: "Attack another player", enabled: p.sleep >= 1 });
    }

    // Wizard powers
    if (p.classId === "wizard") {
      if (p.mana >= 1) {
        actions.push({ id: "wizard_read", label: "Read another's last path (-1 mana, -1 fear)", enabled: p.fear >= 1 });
      }
      if (p.mana >= 1) {
        actions.push({ id: "wizard_stride", label: "Stride (-2 mana, glide up to 3 tiles)", enabled: p.mana >= 2 && p.sleep >= 1 });
      }
    }

    // Ranger powers
    if (p.classId === "ranger") {
      if (p.sleep >= 1) {
        actions.push({ id: "ranger_trap", label: "Mark another's next card (-1 sleep)", enabled: true });
      }
      if (p.sleep >= 2) {
        actions.push({ id: "ranger_plant_trap", label: "Plant a trap on a neighbor tile (-2 sleep)", enabled: true });
      }
    }

    // End turn (e.g. if you don't want to do anything)
    actions.push({ id: "wait", label: "Wait. Listen.", enabled: true });

    return actions;
  }

  /* ------- Dispatch ------- */
  function doAction(actionId) {
    const p = currentPlayer();
    switch (actionId) {
      case "move":          return actMoveChoose(p);
      case "rest":          return actRest(p);
      case "scan":          return actScan(p);
      case "treat":         return actTreat(p);
      case "attack":        return actAttackChoose(p);
      case "wizard_read":   return actWizardRead(p);
      case "wizard_stride": return actWizardStride(p);
      case "ranger_trap":   return actRangerTrap(p);
      case "ranger_plant_trap": return actPlantTrap(p);
      case "wait":          return actWait(p);
    }
  }

  /* ------- Action implementations ------- */
  function actMoveChoose(p) {
    const neighbors = Grid.neighbors(p.position).filter(
      n => !Grid.isDark(n, state.darkRings)
    );
    UI.showMoveChoice(p, neighbors, (destId) => {
      commitMove(p, destId);
    });
  }

  function commitMove(p, destId, options) {
    const opts = options || {};
    const tile = state.map.tiles[destId];
    const cost = opts.freeMove ? 0 : Grid.moveCost(tile, p.classId);
    if (cost > 0) adjustStat(p, "sleep", -cost);

    const fromCol = Grid.colOf(p.position), fromRow = Grid.rowOf(p.position);
    p.position = destId;
    p.revealedTiles.add(destId);
    const toCol = Grid.colOf(destId), toRow = Grid.rowOf(destId);
    const biomeNote = tile.biome === "mountain" ? " (mountain)" : tile.biome === "river" ? " (river)" : "";
    logLine(`${p.name} moves to (${toCol},${toRow})${biomeNote}.`, "dim");

    // Trigger trap if there is one (planted by someone else).
    if (tile.trap && tile.trap.plantedBy !== p.id) {
      const planter = state.players.find(x => x.id === tile.trap.plantedBy);
      const hit = -adjustStat(p, "health", -4);
      adjustStat(p, "fear", -2);
      logLine(`${p.name} steps on something nasty. -${hit} health, -2 fear.`, "bad");
      // Planter gets a private note (they'll see it on their next turn).
      if (planter) {
        planter.secrets = planter.secrets || [];
        planter.secrets.push({ tag: "trap_hit", text: `Your trap at tile #${destId} caught ${p.name}.` });
      }
      tile.trap = null;
    }

    // If the tile has already been consumed, no card resolves.
    if (tile.consumed) {
      UI.showCard(
        { title: `Tile #${destId}`, kind: "Known ground", body: "You have been here before. Nothing remains." },
        null,
        () => { if (!opts.skipFinish) finishTurn(p); else opts.afterMove && opts.afterMove(); }
      );
      return;
    }

    // Reveal & resolve the tile's card.
    let cardId = tile.cardId;

    // Sour Luck flag: ghosts ruin this arrival — swap to a Threat card.
    if (state.flags.souredFor === p.id) {
      state.flags.souredFor = null;
      const threats = CARDS.filter(c => c.kind === "Threat");
      cardId = RNG.pick(threats).id;
      logLine(`Something tilts against ${p.name}.`, "ghost");
    }

    // Ranger-trap override on this player's next reveal.
    if (state.flags.rangerNextCardForce && state.flags.rangerNextCardForce.playerId === p.id) {
      cardId = state.flags.rangerNextCardForce.cardId;
      state.flags.rangerNextCardForce = null;
    }

    state.lastDrawn[p.id] = cardId;
    const card = CARDS.find(c => c.id === cardId);
    tile.consumed = true;

    const out = card.resolve(state, p);
    UI.showCard(card, out, () => {
      if (out && out.log) for (const l of out.log) logLine(l.text, l.tone);
      if (!out || !out.options) finishTurn(p);
    });
  }

  function resolveCardOption(option) {
    const p = currentPlayer();
    const res = option.action();
    if (res && res.log) for (const l of res.log) logLine(l.text, l.tone);
    UI.clearCardOptions();
    finishTurn(p);
  }

  function actRest(p) {
    if (state.flags.disturbedRestFor === p.id) {
      state.flags.disturbedRestFor = null;
      logLine(`${p.name} closes their eyes. Something is wrong with the quiet. No rest returns.`, "ghost");
    } else {
      const s = adjustStat(p, "sleep", +2);
      const f = adjustStat(p, "fear", +1);
      const h = adjustStat(p, "health", +1);
      const parts = [];
      if (s > 0) parts.push(`Sleep +${s}`);
      if (f > 0) parts.push(`Fear +${f}`);
      if (h > 0) parts.push(`Health +${h}`);
      logLine(`${p.name} rests. ${parts.join(", ") || "Nothing returns."}`, "good");
      if (p.classId === "wizard") {
        const m = adjustStat(p, "mana", +1);
        if (m > 0) logLine(`The wizard breathes; mana +${m}.`, "good");
      }
    }
    finishTurn(p);
  }

  function actTreat(p) {
    adjustStat(p, "sleep", -2);
    if (p.conditions && p.conditions.poison > 0) {
      p.conditions.poison = 0;
      logLine(`${p.name} cleans the wound. The poison stops.`, "good");
    } else {
      const h = adjustStat(p, "health", +3);
      logLine(`${p.name} treats their wounds. Health +${h}.`, "good");
    }
    finishTurn(p);
  }

  function actScan(p) {
    adjustStat(p, "fear", -2);
    p.scanActiveThisRound = true;
    // Write every living player's current tile into our memory.
    p.knownPositions = p.knownPositions || {};
    const sightings = [];
    for (const o of state.players) {
      if (!o.alive || o.id === p.id) continue;
      p.knownPositions[o.id] = { tile: o.position, round: state.round };
      const d = Grid.distance(p.position, o.position);
      const weaponNames = o.weapons.map(w => w.name).join(", ");
      sightings.push(`${o.name}: tile #${o.position} (${Grid.colOf(o.position)},${Grid.rowOf(o.position)}) — ${d} away. Carries: ${weaponNames}.`);
    }
    if (sightings.length === 0) sightings.push("The wood is empty of the living.");
    UI.showCard(
      { title: "You sharpen your senses", kind: "Scan", body: "For a moment the fog thins. You see them through the trees." },
      { log: sightings.map(s => ({ text: s, tone: "dim" })) },
      () => {
        for (const s of sightings) logLine(s, "dim");
        finishTurn(p);
      }
    );
  }

  function actAttackChoose(p) {
    const targets = Combat.validTargets(state, p);
    UI.showAttackMenu(p, targets, (target, option) => {
      const res = Combat.resolve(state, p, target, option);
      for (const l of res.log) logLine(l.text, l.tone);
      finishTurn(p);
    });
  }

  function actWizardRead(p) {
    adjustStat(p, "mana", -1);
    adjustStat(p, "fear", -1);
    const others = state.players.filter(o => o.alive && o.id !== p.id);
    UI.chooseTarget("Whose path do you read?", others, (target) => {
      const cid = state.lastDrawn[target.id];
      if (!cid) {
        logLine(`${target.name}'s path is still hidden. Nothing comes.`, "dim");
      } else {
        const card = CARDS.find(c => c.id === cid);
        logLine(`${p.name} sees what ${target.name} last saw: ${card.title}.`, "good");
        p.secrets.push({ tag: "read", text: `${target.name}'s last card was: ${card.title}` });
      }
      finishTurn(p);
    });
  }

  function actRangerTrap(p) {
    adjustStat(p, "sleep", -1);
    const others = state.players.filter(o => o.alive && o.id !== p.id);
    UI.chooseTarget("Whose next path do you mark?", others, (target) => {
      const threats = CARDS.filter(c => c.kind === "Threat");
      const forced = RNG.pick(threats);
      state.flags.rangerNextCardForce = { playerId: target.id, cardId: forced.id };
      logLine(`${p.name} leaves something behind for ${target.name}.`, "warn");
      finishTurn(p);
    });
  }

  function actPlantTrap(p) {
    const candidates = [p.position, ...Grid.neighbors(p.position)]
      .filter(id => !Grid.isDark(id, state.darkRings) && !state.map.tiles[id].trap);
    const list = candidates.map(id => ({ id, name: `Tile #${id}` }));
    UI.chooseTarget("Where do you plant the trap?", list, (target) => {
      adjustStat(p, "sleep", -2);
      state.map.tiles[target.id].trap = { plantedBy: p.id };
      p.secrets.push({ tag: "trap", text: `You planted a trap at tile #${target.id}.` });
      logLine(`${p.name} sets something quietly.`, "dim");
      finishTurn(p);
    });
  }

  /* Wizard Stride — pick a destination up to 3 tiles away, paying 2 mana + 1
     sleep total (regardless of biome). Each tile traversed reveals/resolves
     only the final destination card (the wizard glides past the rest). */
  function actWizardStride(p) {
    // BFS to find tiles reachable within radius 3, excluding dark tiles.
    const radius = 3;
    const visited = new Set([p.position]);
    let frontier = [p.position];
    const reachable = [];
    for (let d = 0; d < radius; d++) {
      const next = [];
      for (const t of frontier) {
        for (const n of Grid.neighbors(t)) {
          if (visited.has(n)) continue;
          if (Grid.isDark(n, state.darkRings)) continue;
          visited.add(n);
          next.push(n);
          reachable.push(n);
        }
      }
      frontier = next;
    }
    if (reachable.length === 0) {
      logLine(`${p.name} cannot stride from here.`, "dim");
      return finishTurn(p);
    }
    UI.showMoveChoice(p, reachable, (destId) => {
      adjustStat(p, "mana", -2);
      // Skip biome costs by passing freeMove; commitMove will still pay 0 sleep.
      // Charge a flat 1 sleep here for the gust of effort.
      adjustStat(p, "sleep", -1);
      commitMove(p, destId, { freeMove: true });
    });
  }

  function actWait(p) {
    // recover 1 fear by sitting still
    const f = adjustStat(p, "fear", +1);
    logLine(`${p.name} sits and listens.${f > 0 ? ` Fear +${f}.` : ""}`, "dim");
    finishTurn(p);
  }

  /* ------- End-of-turn / round flow ------- */
  function finishTurn(p) {
    // Madness check
    if (p.alive && p.sleep <= 0 && p.fear <= 0) {
      p.alive = false;
      p.killedBy = null;
      p.ghost = Ghosts.create(p, null);
      logLine(`${p.name} goes mad in the wood. There is no body to find.`, "ghost");
    }

    // Death by health <= 0 (would already be set in combat/card resolution)
    if (p.alive && p.health <= 0) {
      p.alive = false;
      p.ghost = p.ghost || Ghosts.create(p, null);
      logLine(`${p.name} falls quietly.`, "ghost");
    }

    // Win check (immediate)
    if (p.alive && p.artefacts >= ARTEFACTS_TO_WIN && state.round >= ROUND_TOTAL) {
      return endGame(p);
    }

    advance();
  }

  function advance() {
    // Move to next living player; if none, run ghost turns; then next round.
    state.turnIdx += 1;
    while (state.turnIdx < state.seatOrder.length) {
      const next = state.players.find(x => x.id === state.seatOrder[state.turnIdx]);
      if (next && next.alive) {
        state.activeId = next.id;
        UI.clearStage();
        UI.toPrivacy(next);
        return;
      }
      state.turnIdx += 1;
    }

    // Living turns are done. Now ghost turns.
    state.ghostQueue = state.players
      .filter(p => !p.alive && p.ghost && (p.ghost.bornRound !== null))
      .map(p => p.id);

    // Also: any ghost born THIS round just got its first round of rest.
    for (const p of state.players) {
      if (!p.alive && p.ghost && p.ghost.bornRound === null) {
        p.ghost.bornRound = state.round; // will act next round
      }
    }

    runNextGhost();
  }

  function runNextGhost() {
    if (state.ghostQueue.length === 0) {
      return startNextRound();
    }
    const ghostPid = state.ghostQueue.shift();
    state.activeId = ghostPid;
    const dead = state.players.find(p => p.id === ghostPid);
    UI.toGhost(dead);
  }

  function resolveGhostAction(option) {
    if (option) {
      option.execute(state);
    } else {
      logLine(`Something hesitates in the wood. Nothing happens.`, "ghost");
    }
    runNextGhost();
  }

  function startNextRound() {
    state.round += 1;
    if (state.round > ROUND_TOTAL) {
      return endGame(null);
    }

    // The wood closes in every RING_EVERY rounds.
    const targetRings = Math.min(MAX_DARK_RINGS, Math.floor((state.round - 1) / RING_EVERY));
    if (targetRings > state.darkRings) {
      state.darkRings = targetRings;
      logLine(`The fog rolls in. The wood is smaller. Outer ${state.darkRings} ring${state.darkRings > 1 ? "s" : ""} are dark.`, "ghost");
      // Move any unconsumed artefacts out of the dark zone into the interior.
      for (const t of state.map.tiles) {
        if (t.consumed) continue;
        if (!Grid.isDark(t.id, state.darkRings)) continue;
        if (t.cardId === "artefact_fragment") {
          let dest = Grid.randomInteriorTile(state.darkRings);
          let tries = 0;
          while ((state.map.tiles[dest].cardId === "artefact_fragment" || state.map.tiles[dest].consumed) && tries < 20) {
            dest = Grid.randomInteriorTile(state.darkRings);
            tries++;
          }
          state.map.tiles[dest].cardId = "artefact_fragment";
          state.map.tiles[dest].consumed = false;
          t.cardId = "empty_clearing";
        }
      }
    }

    state.turnIdx = 0;
    while (state.turnIdx < state.seatOrder.length) {
      const p = state.players.find(x => x.id === state.seatOrder[state.turnIdx]);
      if (p && p.alive) break;
      state.turnIdx += 1;
    }
    if (state.turnIdx >= state.seatOrder.length) {
      return endGame(null);
    }
    state.activeId = state.seatOrder[state.turnIdx];
    logLine(`Round ${state.round}.`, "dim");
    UI.clearStage();
    UI.toPrivacy(currentPlayer());
  }

  function endGame(winner) {
    state.phase = "end";
    UI.toEnd(winner, state);
  }

  /* ------- Public ------- */
  return {
    state,
    start,
    currentPlayer,
    availableActions,
    doAction,
    resolveCardOption,
    resolveGhostAction,
    logLine,
    beginActiveTurn,
    canSee,
    sightRange,
  };
})();

/* Boot once DOM is ready. */
document.addEventListener("DOMContentLoaded", () => {
  UI.bootSetup();
});
