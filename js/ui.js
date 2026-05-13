/* UI layer. Pure DOM. No frameworks. */

const UI = (() => {

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  function showScreen(id) {
    for (const s of document.querySelectorAll(".screen")) s.classList.add("hidden");
    document.getElementById(id).classList.remove("hidden");
  }

  /* ============ SETUP ============ */
  function bootSetup() {
    const countSel = $("#player-count");
    const seedInput = $("#seed-input");

    function renderRows() {
      const n = parseInt(countSel.value, 10);
      const wrap = $("#player-config");
      wrap.innerHTML = "";
      for (let i = 0; i < n; i++) {
        const row = el("div", "player-row");
        const nameIn = el("input");
        nameIn.placeholder = `Player ${i + 1} name`;
        nameIn.dataset.idx = i;
        nameIn.dataset.role = "name";

        const classSel = document.createElement("select");
        classSel.dataset.idx = i;
        classSel.dataset.role = "class";
        for (const cid of ["dwarf", "wizard", "ranger"]) {
          const opt = document.createElement("option");
          opt.value = cid;
          opt.textContent = `${CLASSES[cid].name} — ${CLASSES[cid].blurb}`;
          classSel.appendChild(opt);
        }
        // default different classes if possible
        classSel.selectedIndex = i % 3;

        row.appendChild(nameIn);
        row.appendChild(classSel);
        wrap.appendChild(row);
      }
    }
    countSel.addEventListener("change", renderRows);
    renderRows();

    $("#start-btn").addEventListener("click", () => {
      const n = parseInt(countSel.value, 10);
      const players = [];
      for (let i = 0; i < n; i++) {
        const nameEl = document.querySelector(`input[data-idx="${i}"][data-role="name"]`);
        const classEl = document.querySelector(`select[data-idx="${i}"][data-role="class"]`);
        players.push(makePlayer({
          id: `p${i + 1}`,
          name: (nameEl.value || `Player ${i + 1}`).slice(0, 24),
          classId: classEl.value,
        }));
      }
      Game.start({ seed: seedInput.value.trim(), players });
    });

    $("#privacy-continue").addEventListener("click", () => {
      const p = Game.currentPlayer();
      if (!p || !p.alive) {
        showScreen("game");
        return;
      }
      // Apply start-of-turn effects (poison) and refresh sight.
      Game.beginActiveTurn();
      // beginActiveTurn may have killed the player by poison; re-check.
      const after = Game.currentPlayer();
      if (!after || !after.alive) {
        // game advanced; UI handles the next screen
        return;
      }
      renderGame();
      showScreen("game");
    });

    $("#ghost-skip").addEventListener("click", () => Game.resolveGhostAction(null));

    $("#end-restart").addEventListener("click", () => {
      window.location.reload();
    });
  }

  /* ============ PRIVACY ============ */
  function toPrivacy(player) {
    $("#privacy-name").textContent = player.name;
    $("#privacy-flavor").textContent = privacyFlavor(player);
    showScreen("privacy");
  }
  function privacyFlavor(p) {
    if (p.health <= 2) return "You are not well. The others should not know how badly.";
    if (p.fear <= 2)   return "Your hands shake. The others should not see.";
    if (p.sleep <= 2)  return "You are tired. The others should not see.";
    return "What you carry is yours alone.";
  }

  /* ============ GAME SCREEN ============ */
  function renderGame() {
    const s = Game.state;
    const p = Game.currentPlayer();
    $("#round-num").textContent = s.round;
    $("#round-total").textContent = 15;
    $("#phase-text").textContent = `Day. ${p.name}'s turn.`;
    renderActivePanel(p);
    renderOthers(p);
    renderActions(p);
    renderMap(p);
    renderIdleStage(p);
    renderLog();
  }

  /* The status / hints panel that fills the card stage when no card is open. */
  function renderIdleStage(p) {
    const s = Game.state;
    const stage = $("#card-stage");
    // Don't overwrite an active card prompt
    if (stage.dataset.activeCard === "1") return;
    stage.innerHTML = "";
    stage.dataset.activeCard = "0";

    stage.appendChild(el("div", "card-kind", `Tile #${p.position}`));
    const here = s.map ? s.map.tiles[p.position] : null;
    const title = here && here.consumed
      ? `You stand at (${Grid.colOf(p.position)},${Grid.rowOf(p.position)}). Known ground.`
      : `You stand at (${Grid.colOf(p.position)},${Grid.rowOf(p.position)}).`;
    stage.appendChild(el("h2", "card-title", title));

    // Conditions
    const condParts = [];
    if (p.conditions && p.conditions.poison > 0) {
      condParts.push(`Poisoned — losing 1 health for ${p.conditions.poison} more turn${p.conditions.poison > 1 ? "s" : ""}.`);
    }
    if (p.scanActiveThisRound) condParts.push("Your senses are sharp. The wood is thinner.");
    if (p.fear <= 2)  condParts.push("Your hands shake. One more shock could break you.");
    if (p.sleep <= 2) condParts.push("You can barely keep your eyes open.");
    if (p.health <= 3) condParts.push("You are badly hurt.");
    if (condParts.length === 0) condParts.push("You feel steady, for now.");
    const cond = el("p", "card-body");
    cond.textContent = condParts.join(" ");
    stage.appendChild(cond);

    // What's around — names of any neighbor tiles you've revealed
    if (s.map) {
      const ns = Grid.neighbors(p.position);
      const known = ns.filter(n => p.revealedTiles && p.revealedTiles.has(n));
      if (known.length > 0) {
        const list = known.map(n => {
          const t = s.map.tiles[n];
          const labelMap = {
            empty_clearing: "an empty clearing",
            old_path:       "an old path",
            still_water:    "a still pool",
            artefact_fragment: t.consumed ? "where you took an artefact" : "an artefact fragment",
            ruins_npc:      "a ruin (wanderer)",
            chest:          t.consumed ? "an empty chest" : "a chest",
            hidden_cache:   t.consumed ? "an empty cache" : "a cache",
            wild_boar:      "boar tracks",
            wolves:         "wolf signs",
            snake:          "snake grass",
            whisper:        "where the whispers came from",
            shape_at_treeline: "the shape at the treeline",
            lost_trail:     "the trail that loops",
            ghost_sighting: "where you saw someone you knew",
          };
          return `#${n}: ${labelMap[t.cardId] || t.cardId}`;
        });
        const around = el("p", "card-body");
        around.textContent = "Around you: " + list.join(" · ");
        stage.appendChild(around);
      }
    }

    // Sightings of others
    const sightings = [];
    for (const o of s.players) {
      if (o.id === p.id || !o.alive) continue;
      if (Game.canSee(p, o)) {
        const d = Grid.distance(p.position, o.position);
        sightings.push(`${o.name} is ${d === 0 ? "here with you" : `${d} tile${d > 1 ? "s" : ""} away`} (tile #${o.position})`);
      } else if (p.knownPositions && p.knownPositions[o.id]) {
        const k = p.knownPositions[o.id];
        const ago = s.round - k.round;
        sightings.push(`${o.name} was at tile #${k.tile} ${ago === 0 ? "earlier this round" : `${ago} round${ago>1?"s":""} ago`}`);
      }
    }
    if (sightings.length > 0) {
      const seenWrap = el("p", "card-body");
      seenWrap.textContent = "You see: " + sightings.join(". ") + ".";
      stage.appendChild(seenWrap);
    }

    // Secrets (your private notes)
    if (p.secrets && p.secrets.length) {
      const hint = el("p", "card-body");
      hint.style.color = "var(--accent)";
      hint.textContent = "What only you know: " + p.secrets.slice(-3).map(s => s.text).join(" · ");
      stage.appendChild(hint);
    }
  }

  /* ---------- Map ---------- */
  // Hex geometry (pointy-top, odd-r offset).
  const HEX_SIZE = 11;                            // circumradius in px
  const HEX_W = Math.sqrt(3) * HEX_SIZE;          // width
  const HEX_H = 2 * HEX_SIZE;                     // height
  const ROW_STEP = 1.5 * HEX_SIZE;                // vertical step between rows

  function tileCenter(col, row) {
    const x = HEX_W * (col + 0.5 * (row & 1)) + HEX_W * 0.6;
    const y = ROW_STEP * row + HEX_SIZE + 2;
    return { x, y };
  }

  function hexPoints(cx, cy) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const ang = Math.PI / 180 * (60 * i - 90); // pointy-top: -90 start
      pts.push(`${(cx + HEX_SIZE * Math.cos(ang)).toFixed(2)},${(cy + HEX_SIZE * Math.sin(ang)).toFixed(2)}`);
    }
    return pts.join(" ");
  }

  // Which biomes show as "landmarks" once consumed (different fill tint).
  const LANDMARK_CARDS = new Set([
    "artefact_fragment", "ruins_npc", "chest", "hidden_cache",
    "wild_boar", "wolves", "snake", "whisper", "shape_at_treeline",
    "lost_trail", "ghost_sighting", "still_water"
  ]);

  let activeReachableSet = null;       // set of tile ids highlighted as reachable
  let activeReachableHandler = null;   // function(destId) when a reachable tile is clicked

  function renderMap(p) {
    const s = Game.state;
    if (!s.map) return;
    const svg = $("#map-svg");
    svg.innerHTML = "";

    const totalW = HEX_W * (s.map.cols + 0.5) + HEX_W * 0.6;
    const totalH = ROW_STEP * s.map.rows + HEX_SIZE + 4;
    svg.setAttribute("viewBox", `0 0 ${totalW} ${totalH}`);
    svg.setAttribute("width", totalW);
    svg.setAttribute("height", totalH);

    // Where the active player thinks each *other* player is.
    // Real-time sight (close enough now) vs remembered sight (from scan or
    // past proximity in this round).
    const visibleOthers = Object.create(null);     // tileId -> [{player, freshness}]
    for (const pl of s.players) {
      if (pl.id === p.id) continue;
      if (!pl.alive) continue;
      let tileId = null, freshness = null;
      if (Game.canSee(p, pl)) {
        tileId = pl.position;
        freshness = "fresh";
      } else if (p.knownPositions && p.knownPositions[pl.id]) {
        tileId = p.knownPositions[pl.id].tile;
        freshness = "memory";
      }
      if (tileId == null) continue;
      (visibleOthers[tileId] = visibleOthers[tileId] || []).push({ player: pl, freshness });
    }

    // Card-kind lookup for peek hints.
    const cardKind = (cid) => {
      const c = CARDS.find(x => x.id === cid);
      return c ? c.kind : "";
    };
    const kindClass = (kind) => {
      if (kind === "Threat") return "k-threat";
      if (kind === "Eerie")  return "k-eerie";
      if (kind === "Find")   return "k-find";
      if (kind === "Boon")   return "k-boon";
      if (kind === "Artefact") return "k-artefact";
      return "k-quiet";
    };

    const tiles = s.map.tiles;
    for (const t of tiles) {
      const { x, y } = tileCenter(t.col, t.row);
      const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      poly.setAttribute("points", hexPoints(x, y));

      const knownByMe = p.revealedTiles && p.revealedTiles.has(t.id);
      const peeked    = !knownByMe && p.peekedTiles && p.peekedTiles.has(t.id);
      const isMe      = t.id === p.position;
      const here      = visibleOthers[t.id];
      const occByOther = !!here;
      const reachable = activeReachableSet && activeReachableSet.has(t.id);
      const dark      = Grid.isDark(t.id, s.darkRings || 0);

      let cls = "tile";
      if (dark) {
        cls += " dark";
      } else if (!knownByMe && !peeked && !occByOther && !reachable && !isMe) {
        cls += " fog";
      } else if (peeked && !knownByMe) {
        cls += " peeked " + kindClass(cardKind(t.cardId));
      } else if (LANDMARK_CARDS.has(t.cardId) && t.consumed && knownByMe) {
        cls += " landmark";
      } else {
        cls += " revealed";
      }
      if (occByOther) cls += " has-other";
      if (isMe)       cls += " you";
      if (reachable)  cls += " reach";

      poly.setAttribute("class", cls);
      poly.dataset.tile = t.id;

      if (reachable && activeReachableHandler) {
        poly.addEventListener("click", () => {
          const handler = activeReachableHandler;
          activeReachableSet = null;
          activeReachableHandler = null;
          handler(t.id);
        });
      }

      svg.appendChild(poly);

      // Self token
      if (isMe) {
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", x);
        text.setAttribute("y", y + 3);
        text.setAttribute("text-anchor", "middle");
        text.textContent = "★";
        text.setAttribute("class", "token you");
        svg.appendChild(text);
      }
      // Other players (only the ones we sense or remember)
      if (here && here.length) {
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", x);
        text.setAttribute("y", y + 3);
        text.setAttribute("text-anchor", "middle");
        text.textContent = here.map(h => h.player.name[0].toUpperCase()).join("");
        const isMemory = here.every(h => h.freshness === "memory");
        text.setAttribute("class", "token other" + (isMemory ? " memory" : ""));
        svg.appendChild(text);
      }
    }

    // Header coord
    $("#map-coord").textContent = `you: tile #${p.position} (${Grid.colOf(p.position)},${Grid.rowOf(p.position)})`;
  }

  function highlightReachable(tileIds, onPick) {
    activeReachableSet = new Set(tileIds);
    activeReachableHandler = onPick;
    renderMap(Game.currentPlayer());
  }
  function clearReachable() {
    activeReachableSet = null;
    activeReachableHandler = null;
    renderMap(Game.currentPlayer());
  }

  /* Called by Game.actMoveChoose: highlights neighbors on the map and waits
     for a click. Also shows a fallback button list in the card stage. */
  function showMoveChoice(p, neighborIds, onPick) {
    const stage = $("#card-stage");
    stage.innerHTML = "";
    stage.dataset.activeCard = "1";
    stage.appendChild(el("div", "card-kind", "Movement"));
    stage.appendChild(el("h2", "card-title", "Where do you step?"));
    stage.appendChild(el("p", "card-body",
      "Pick a neighboring tile on the map, or use the buttons below. Costs 1 sleep."));

    const optsWrap = el("div", "card-options");
    const map = Game.state.map;
    for (const nid of neighborIds) {
      const t = map.tiles[nid];
      const known = p.revealedTiles && p.revealedTiles.has(nid);
      const label = known
        ? `#${nid} (${t.col},${t.row}) — known`
        : `#${nid} (${t.col},${t.row}) — unknown`;
      const b = el("button", "btn", label);
      b.addEventListener("click", () => {
        clearReachable();
        onPick(nid);
      });
      optsWrap.appendChild(b);
    }
    const cancel = el("button", "btn", "Don't move.");
    cancel.addEventListener("click", () => {
      clearReachable();
      clearStage();
      renderActions(p);
      renderIdleStage(p);
    });
    optsWrap.appendChild(cancel);
    stage.appendChild(optsWrap);

    highlightReachable(neighborIds, onPick);
  }

  function renderActivePanel(p) {
    $("#active-name").textContent = p.name;
    $("#active-class").textContent = CLASSES[p.classId].name;

    const stats = $("#active-stats");
    stats.innerHTML = "";
    const rows = [
      { name: "Health", val: p.health, max: p.maxes.health, danger: 2 },
      { name: "Sleep",  val: p.sleep,  max: p.maxes.sleep,  danger: 1 },
      { name: "Fear",   val: p.fear,   max: p.maxes.fear,   danger: 1 },
    ];
    if (p.maxes.mana > 0) rows.push({ name: "Mana", val: p.mana, max: p.maxes.mana, danger: 0 });
    for (const r of rows) {
      const row = el("div", "stat");
      row.appendChild(el("span", "stat-name", r.name));
      const v = el("span", "stat-val", `${r.val}/${r.max}`);
      if (r.val <= r.danger) v.classList.add("danger");
      else if (r.val <= r.danger + 1) v.classList.add("warn");
      row.appendChild(v);
      stats.appendChild(row);
    }

    const inv = $("#active-inventory");
    inv.innerHTML = "";
    inv.appendChild(el("div", "inv-label", "Carried"));
    for (const w of p.weapons) {
      const item = el("div", "inv-item");
      let txt = `· ${w.name}`;
      if (w.ammo) {
        const have = w.ammo === "mana" ? p.mana : (p.ammo[w.ammo] || 0);
        txt += `  `;
        const span = el("span", "ammo", `(${have} ${w.ammo})`);
        item.textContent = txt;
        item.appendChild(span);
      } else {
        item.textContent = txt;
      }
      inv.appendChild(item);
    }
    // ammo not tied to a weapon
    const orphanAmmo = [];
    if (p.ammo.bolts > 0 && !p.weapons.some(w => w.ammo === "bolts")) orphanAmmo.push(`${p.ammo.bolts} bolts`);
    if (p.ammo.bullets > 0 && !p.weapons.some(w => w.ammo === "bullets")) orphanAmmo.push(`${p.ammo.bullets} bullets`);
    if (orphanAmmo.length) inv.appendChild(el("div", "inv-item", "· " + orphanAmmo.join(", ")));

    if (p.artefacts > 0) inv.appendChild(el("div", "inv-item secret", `· ${p.artefacts} artefact fragment${p.artefacts > 1 ? "s" : ""}`));

    if (p.secrets && p.secrets.length) {
      inv.appendChild(el("div", "inv-label", "What only you know"));
      for (const s of p.secrets.slice(-4)) {
        inv.appendChild(el("div", "inv-item secret", `· ${s.text}`));
      }
    }
  }

  function renderOthers(active) {
    const s = Game.state;
    const wrap = $("#others-summary");
    wrap.innerHTML = "";
    wrap.appendChild(el("div", "inv-label", "The others"));
    for (const o of s.players) {
      if (o.id === active.id) continue;
      const row = el("div", "other-row");
      const name = el("span", "name", o.name);
      if (!o.alive) name.classList.add("dead");
      row.appendChild(name);

      if (!o.alive) {
        row.appendChild(el("span", "pip", "ghost"));
        row.appendChild(el("span", "pip", ""));
        row.appendChild(el("span", "pip", ""));
        wrap.appendChild(row);
        continue;
      }

      const seen = Game.canSee ? Game.canSee(active, o) : true;
      const remembered = !seen && active.knownPositions && active.knownPositions[o.id];

      if (seen) {
        row.appendChild(el("span", "pip", healthSignal(o)));
        row.appendChild(el("span", "pip", fearSignal(o)));
        row.appendChild(el("span", "pip", sleepSignal(o)));
      } else if (remembered) {
        const lastSeen = active.knownPositions[o.id];
        const ago = s.round - lastSeen.round;
        row.appendChild(el("span", "pip", `last seen #${lastSeen.tile}`));
        row.appendChild(el("span", "pip", ago === 0 ? "this round" : `${ago}r ago`));
        row.appendChild(el("span", "pip", ""));
      } else {
        row.appendChild(el("span", "pip", "out of sight"));
        row.appendChild(el("span", "pip", ""));
        row.appendChild(el("span", "pip", ""));
      }

      wrap.appendChild(row);
    }
  }

  // Coarse signals — others see the look, not the numbers.
  function healthSignal(p) {
    if (p.health <= 2) return "limping";
    if (p.health <= 4) return "bruised";
    return "steady";
  }
  function fearSignal(p) {
    if (p.fear <= 2) return "shaking";
    if (p.fear <= 4) return "tense";
    return "calm";
  }
  function sleepSignal(p) {
    if (p.sleep <= 2) return "exhausted";
    if (p.sleep <= 4) return "tired";
    return "alert";
  }

  function renderActions(p) {
    const bar = $("#action-bar");
    bar.innerHTML = "";
    for (const a of Game.availableActions(p)) {
      const b = el("button", "btn", a.label);
      b.disabled = !a.enabled;
      b.addEventListener("click", () => Game.doAction(a.id));
      bar.appendChild(b);
    }
  }

  function renderLog() {
    const s = Game.state;
    const lg = $("#log");
    lg.innerHTML = "";
    for (const entry of s.log.slice(0, 60)) {
      const ln = el("div", "log-line" + (entry.tone ? " " + entry.tone : ""), entry.text);
      lg.appendChild(ln);
    }
  }

  /* ============ Card stage / options ============ */
  function clearStage() {
    const stage = $("#card-stage");
    stage.innerHTML = "";
    stage.dataset.activeCard = "0";
  }
  function clearCardOptions() {
    const opts = $("#card-stage").querySelector(".card-options");
    if (opts) opts.remove();
  }

  function showCard(card, result, afterRender) {
    const stage = $("#card-stage");
    stage.innerHTML = "";
    stage.dataset.activeCard = "1";
    stage.appendChild(el("div", "card-kind", card.kind || ""));
    stage.appendChild(el("h2", "card-title", card.title));
    if (card.body) stage.appendChild(el("p", "card-body", card.body));

    if (result && result.log) {
      for (const l of result.log) {
        stage.appendChild(el("p", "card-body", l.text));
      }
    }

    if (result && result.options) {
      const optsWrap = el("div", "card-options");
      for (const opt of result.options) {
        const b = el("button", "btn", opt.label);
        b.addEventListener("click", () => {
          Game.resolveCardOption(opt);
          renderGame();
        });
        optsWrap.appendChild(b);
      }
      stage.appendChild(optsWrap);
    }

    // Refresh sidebar and log immediately to reflect any state changes from resolve()
    renderActivePanel(Game.currentPlayer());
    renderOthers(Game.currentPlayer());
    renderLog();

    if (afterRender) afterRender();
  }

  function showAttackMenu(attacker, targets, onChoose) {
    const stage = $("#card-stage");
    stage.innerHTML = "";
    stage.dataset.activeCard = "1";
    stage.appendChild(el("div", "card-kind", "Violence"));
    stage.appendChild(el("h2", "card-title", "Who do you turn on?"));
    stage.appendChild(el("p", "card-body", "Every attack costs you sleep and nerve. The others will see the weapon."));

    if (targets.length === 0) {
      stage.appendChild(el("p", "card-body", "No one is close enough."));
      const back = el("button", "btn", "Step back.");
      back.addEventListener("click", () => { clearStage(); renderGame(); });
      stage.appendChild(back);
      return;
    }

    for (const t of targets) {
      const dist = (Game.state.map ? Grid.distance(attacker.position, t.position) : 0);
      const header = el("p", "card-body",
        `Against ${t.name} — ${dist === 0 ? "same tile" : `${dist} tile${dist > 1 ? "s" : ""} away`} (${healthSignal(t)}, ${sleepSignal(t)}, ${fearSignal(t)}):`
      );
      stage.appendChild(header);

      const row = el("div", "card-options");
      const choices = Combat.attackOptions(attacker, t);
      if (choices.length === 0) {
        const note = el("span", "card-body", "Out of reach for any weapon you carry.");
        row.appendChild(note);
      }
      for (const a of choices) {
        const b = el("button", "btn", a.label);
        b.addEventListener("click", () => {
          onChoose(t, a);
          clearStage();
          renderGame();
        });
        row.appendChild(b);
      }
      stage.appendChild(row);
    }

    const back = el("button", "btn", "Don't.");
    back.addEventListener("click", () => { clearStage(); renderGame(); });
    stage.appendChild(back);
  }

  function chooseTarget(prompt, targets, onChoose) {
    const stage = $("#card-stage");
    stage.innerHTML = "";
    stage.dataset.activeCard = "1";
    stage.appendChild(el("h2", "card-title", prompt));
    const optsWrap = el("div", "card-options");
    for (const t of targets) {
      const b = el("button", "btn", t.name);
      b.addEventListener("click", () => {
        onChoose(t);
        renderGame();
      });
      optsWrap.appendChild(b);
    }
    stage.appendChild(optsWrap);
  }

  /* ============ GHOST ============ */
  function toGhost(deadPlayer) {
    showScreen("ghost-turn");
    $("#ghost-name").textContent = deadPlayer.name;
    const wrap = $("#ghost-actions");
    wrap.innerHTML = "";
    const opts = Ghosts.actionsFor(Game.state, deadPlayer.ghost);
    if (opts.length === 0) {
      const note = el("p", "ghost-flavor", "There is no one left for you to touch.");
      wrap.appendChild(note);
      return;
    }
    for (const o of opts) {
      const b = el("button", "btn ghost", o.label);
      b.addEventListener("click", () => Game.resolveGhostAction(o));
      wrap.appendChild(b);
    }
  }

  /* ============ END ============ */
  function toEnd(winner, state) {
    showScreen("end");
    const title = $("#end-title");
    const flavor = $("#end-flavor");
    const sum = $("#end-summary");
    sum.innerHTML = "";

    if (winner) {
      title.textContent = `${winner.name} walked out.`;
      flavor.textContent = "The wood lets one go. It is not finished with the others.";
    } else {
      const survivors = state.players.filter(p => p.alive);
      if (survivors.length === 0) {
        title.textContent = "The wood is quiet again.";
        flavor.textContent = "No one came back.";
      } else {
        title.textContent = "Time runs out.";
        flavor.textContent = survivors.length === 1
          ? `${survivors[0].name} hears morning, but did not find what they needed.`
          : "They reach the edge of the wood. They did not find what they needed.";
      }
    }

    for (const p of state.players) {
      const row = el("div", "end-row");
      const name = el("span", null, p.name + (p.alive ? "" : " (lost)"));
      const detail = el("span", null,
        `artefacts ${p.artefacts} · health ${p.health} · fear ${p.fear} · sleep ${p.sleep}`
      );
      row.appendChild(name);
      row.appendChild(detail);
      sum.appendChild(row);
    }
  }

  return {
    bootSetup,
    toPrivacy,
    toGhost,
    toEnd,
    renderGame,
    renderMap,
    showCard,
    showAttackMenu,
    showMoveChoice,
    chooseTarget,
    clearStage,
    clearCardOptions,
  };
})();
