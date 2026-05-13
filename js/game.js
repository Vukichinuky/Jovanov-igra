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
  const ROUND_TOTAL = 10;
  const ARTEFACTS_TO_WIN = 2;

  const state = {
    phase: "setup",
    round: 1,
    players: [],
    seatOrder: [],          // ids in turn order
    turnIdx: 0,             // index into seatOrder for living turns
    ghostQueue: [],         // ids of dead players still to take a ghost turn this round
    activeId: null,
    deck: [],
    log: [],
    flags: {
      souredFor: null,
      disturbedRestFor: null,
      rangerNextCardForce: null,
    },
    // last drawn card, for wizard read-card power
    lastDrawn: {},          // playerId -> cardId
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

  /* ------- Turn actions available to the active player ------- */
  function availableActions(p) {
    const actions = [
      { id: "explore", label: "Explore the wood (-1 sleep)", enabled: p.sleep >= 1 },
      { id: "rest",    label: "Rest (sleep +2)",            enabled: p.fear > 0 },
      { id: "scan",    label: "Scan the others (-1 fear)",  enabled: p.fear >= 1 },
    ];

    // Attack other players
    if (Combat.validTargets(state, p).length > 0) {
      actions.push({ id: "attack", label: "Attack another player", enabled: p.sleep >= 1 });
    }

    // Wizard power
    if (p.classId === "wizard" && p.mana >= 1) {
      actions.push({ id: "wizard_read", label: "Read another's last path (-1 mana, -1 fear)", enabled: p.fear >= 1 });
    }

    // Ranger power
    if (p.classId === "ranger" && p.sleep >= 1) {
      actions.push({ id: "ranger_trap", label: "Mark another's next card (-1 sleep)", enabled: true });
    }

    // End turn (e.g. if you don't want to do anything)
    actions.push({ id: "wait", label: "Wait. Listen.", enabled: true });

    return actions;
  }

  /* ------- Dispatch ------- */
  function doAction(actionId) {
    const p = currentPlayer();
    switch (actionId) {
      case "explore":     return actExplore(p);
      case "rest":        return actRest(p);
      case "scan":        return actScan(p);
      case "attack":      return actAttackChoose(p);
      case "wizard_read": return actWizardRead(p);
      case "ranger_trap": return actRangerTrap(p);
      case "wait":        return actWait(p);
    }
  }

  /* ------- Action implementations ------- */
  function actExplore(p) {
    adjustStat(p, "sleep", -1);

    // Apply poison (snake) if it was pending
    const poison = p.secrets.find(s => s.tag === "poisoned");
    if (poison) {
      adjustStat(p, "sleep", -1);
      logLine(`The poison takes another hour from ${p.name}.`, "bad");
      p.secrets = p.secrets.filter(s => s.tag !== "poisoned");
    }

    let card = Deck.draw(state, p);

    // Sour Luck flag: ghosts ruin this draw — draw twice, take the worse.
    if (state.flags.souredFor === p.id) {
      state.flags.souredFor = null;
      const alt = Deck.draw(state, p);
      // pick worse: any with kind "Threat" or "Eerie" beats a non-threat
      const ranks = { "Threat": 3, "Eerie": 2, "Quiet": 1, "Find": 0, "Artefact": -1 };
      const worse = (ranks[alt.kind] >= ranks[card.kind]) ? alt : card;
      const better = worse === alt ? card : alt;
      // put 'better' back on top of deck (next person gets a slightly better world)
      state.deck.push(better.id);
      card = worse;
      logLine(`Something tilts against ${p.name}.`, "ghost");
    }

    state.lastDrawn[p.id] = card.id;

    const out = card.resolve(state, p);
    UI.showCard(card, out, () => {
      if (out && out.log) for (const l of out.log) logLine(l.text, l.tone);
      // If card had options, UI will call resolveOption -> finishTurn; otherwise advance now
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
      logLine(`${p.name} closes their eyes. Something is wrong with the quiet. No sleep returns.`, "ghost");
    } else {
      const gained = adjustStat(p, "sleep", +2);
      logLine(`${p.name} rests. Sleep +${gained}.`, "good");
      // small mana recovery for wizard
      if (p.classId === "wizard") {
        const m = adjustStat(p, "mana", +1);
        if (m > 0) logLine(`The wizard breathes; mana +${m}.`, "good");
      }
    }
    finishTurn(p);
  }

  function actScan(p) {
    adjustStat(p, "fear", -1);
    const others = state.players.filter(o => o.alive && o.id !== p.id);
    // What the scanner sees: weapon names, but not ammo counts.
    const sightings = others.map(o => {
      const weaponNames = o.weapons.map(w => w.name).join(", ");
      return `${o.name} carries: ${weaponNames}`;
    });
    UI.showCard(
      { title: "You watch the others", kind: "Scan", body: "You can see what they hold. Not whether it bites." },
      { log: sightings.map(s => ({ text: s, tone: "dim" })) },
      () => {
        for (const s of sightings) logLine(s, "dim");
        finishTurn(p);
      }
    );
  }

  function actAttackChoose(p) {
    const targets = Combat.validTargets(state, p);
    UI.showAttackMenu(p, targets, (target, weapon) => {
      const res = Combat.resolve(state, p, target, weapon);
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
      // The "trap" forces a Threat card on their next exploration.
      const threats = CARDS.filter(c => c.kind === "Threat");
      const forced = RNG.pick(threats);
      state.flags.rangerNextCardForce = { playerId: target.id, cardId: forced.id };
      logLine(`${p.name} leaves something behind for ${target.name}.`, "warn");
      finishTurn(p);
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
    state.turnIdx = 0;
    // skip to first living player
    while (state.turnIdx < state.seatOrder.length) {
      const p = state.players.find(x => x.id === state.seatOrder[state.turnIdx]);
      if (p && p.alive) break;
      state.turnIdx += 1;
    }
    if (state.turnIdx >= state.seatOrder.length) {
      // no one alive — the wood wins
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
  };
})();

/* Boot once DOM is ready. */
document.addEventListener("DOMContentLoaded", () => {
  UI.bootSetup();
});
