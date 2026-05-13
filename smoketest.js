/* Headless smoke test: open the game, set up 3 players, play many turns. */
const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const fileUrl = "file://" + path.resolve(__dirname, "index.html");
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const errors = [];
  page.on("pageerror", (err) => {
    const line = "PAGEERROR: " + err.message + "\n" + (err.stack || "");
    errors.push(line);
    console.log("!! " + line);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const t = "CONSOLE: " + msg.text();
      errors.push(t);
      console.log("!! " + t);
    }
  });

  await page.goto(fileUrl);

  await page.waitForSelector("#setup");
  await page.fill("#seed-input", "smoke-2");
  await page.selectOption("#player-count", "3");
  const nameInputs = await page.$$('input[data-role="name"]');
  await nameInputs[0].fill("Ada");
  await nameInputs[1].fill("Bren");
  await nameInputs[2].fill("Cho");

  await page.click("#start-btn");
  await page.waitForSelector("#privacy:not(.hidden)");

  async function playOneTurn() {
    if (await page.$("#privacy:not(.hidden)")) {
      await page.click("#privacy-continue");
    }
    await page.waitForSelector("#game:not(.hidden), #ghost-turn:not(.hidden), #end:not(.hidden)");

    if (await page.$("#ghost-turn:not(.hidden)")) {
      await page.click("#ghost-skip");
      return;
    }
    if (await page.$("#end:not(.hidden)")) return "end";

    // Make sure the map rendered with tile polygons
    const tileCount = await page.$$eval("#map-svg polygon", els => els.length);
    if (tileCount !== 400) {
      errors.push(`MAP: expected 400 tiles, got ${tileCount}`);
    }

    // Pick first enabled non-attack action
    const buttons = await page.$$("#action-bar button");
    let clicked = false;
    for (const b of buttons) {
      const disabled = await b.isDisabled();
      const text = (await b.textContent()) || "";
      if (!disabled && !/Attack/i.test(text)) {
        await b.click();
        clicked = true;
        break;
      }
    }
    if (!clicked && buttons.length > 0) await buttons[0].click();

    // Walk through any card prompts that appear.
    for (let k = 0; k < 6; k++) {
      await page.waitForTimeout(60);
      if (!(await page.$("#game:not(.hidden)"))) break;
      const opts = await page.$$("#card-stage .card-options button:not([disabled])");
      if (opts.length === 0) break;
      // pick the first option that isn't a cancel — but if it's the only one, click it
      let chosen = opts[0];
      for (const o of opts) {
        const t = (await o.textContent()) || "";
        if (!/Don't|Step back|Walk past|Leave it/i.test(t)) { chosen = o; break; }
      }
      await chosen.click();
    }
  }

  for (let i = 0; i < 80; i++) {
    const res = await playOneTurn();
    if (res === "end") break;
  }

  const visible = await page.$$eval(".screen:not(.hidden)", (els) => els.map(e => e.id));
  const logLines = await page.$$eval("#log .log-line", (els) => els.slice(0, 12).map(e => e.textContent));
  const endTitle = await page.$eval("#end-title", e => e.textContent).catch(() => null);

  // Sample some game-state values via window globals
  const playerPositions = await page.evaluate(() => {
    return Game.state.players.map(p => ({
      name: p.name, alive: p.alive, pos: p.position,
      art: p.artefacts,
      revealedN: p.revealedTiles ? p.revealedTiles.size : 0,
    }));
  });

  console.log("Active screens:", visible);
  if (endTitle) console.log("End title:", endTitle);
  console.log("Players:");
  for (const p of playerPositions) console.log("  ·", p);
  console.log("Last log lines:");
  for (const l of logLines) console.log("  ·", l);

  if (errors.length) {
    console.log("\nERRORS:");
    for (const e of errors) console.log("  !!", e);
    process.exitCode = 1;
  } else {
    console.log("\nNo JS errors.");
  }

  await browser.close();
})();
