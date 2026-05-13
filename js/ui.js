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
      if (!p.alive) {
        // shouldn't happen, but guard
        showScreen("game");
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
    $("#round-total").textContent = 10;
    $("#phase-text").textContent = `Day. ${p.name}'s turn.`;
    renderActivePanel(p);
    renderOthers(p);
    renderActions(p);
    renderLog();
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
      if (o.alive) {
        // Show coarse signals — not exact numbers
        const hp = healthSignal(o);
        const fr = fearSignal(o);
        const sl = sleepSignal(o);
        row.appendChild(el("span", "pip", hp));
        row.appendChild(el("span", "pip", fr));
        row.appendChild(el("span", "pip", sl));
      } else {
        row.appendChild(el("span", "pip", "ghost"));
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
    $("#card-stage").innerHTML = "";
  }
  function clearCardOptions() {
    const opts = $("#card-stage").querySelector(".card-options");
    if (opts) opts.remove();
  }

  function showCard(card, result, afterRender) {
    const stage = $("#card-stage");
    stage.innerHTML = "";
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
    stage.appendChild(el("div", "card-kind", "Violence"));
    stage.appendChild(el("h2", "card-title", "Who do you turn on?"));
    stage.appendChild(el("p", "card-body", "Every attack costs you sleep and nerve. The others will see the weapon."));

    const opts = el("div", "card-options");
    for (const t of targets) {
      const row = el("div", "card-options");
      row.style.flexBasis = "100%";
      const header = el("p", "card-body", `Against ${t.name} (${healthSignal(t)}, ${sleepSignal(t)}, ${fearSignal(t)}):`);
      stage.appendChild(header);
      const choices = Combat.attackOptions(attacker);
      for (const a of choices) {
        const b = el("button", "btn", a.label);
        b.addEventListener("click", () => {
          onChoose(t, a.weapon);
          clearStage();
          renderGame();
        });
        row.appendChild(b);
      }
      // back-out option
      const back = el("button", "btn", "Don't.");
      back.addEventListener("click", () => {
        clearStage();
        renderGame();
        // attack action consumed nothing — let player choose again
      });
      row.appendChild(back);
      stage.appendChild(row);
    }
    stage.appendChild(opts);
  }

  function chooseTarget(prompt, targets, onChoose) {
    const stage = $("#card-stage");
    stage.innerHTML = "";
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
    showCard,
    showAttackMenu,
    chooseTarget,
    clearStage,
    clearCardOptions,
  };
})();
