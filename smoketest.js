/* Headless smoke test: open the game, set up 3 players, play several rounds. */
const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const fileUrl = "file://" + path.resolve(__dirname, "index.html");
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const errors = [];
  page.on("pageerror", (err) => errors.push("PAGEERROR: " + err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push("CONSOLE: " + msg.text());
  });

  await page.goto(fileUrl);

  // Setup screen visible?
  await page.waitForSelector("#setup");
  await page.fill("#seed-input", "smoke-1");
  await page.selectOption("#player-count", "3");
  // names
  const nameInputs = await page.$$('input[data-role="name"]');
  await nameInputs[0].fill("Ada");
  await nameInputs[1].fill("Bren");
  await nameInputs[2].fill("Cho");

  await page.click("#start-btn");
  await page.waitForSelector("#privacy:not(.hidden)");

  // Play a few turns: just click the first available enabled action button.
  async function playOneTurn() {
    // Privacy screen -> continue
    if (await page.$("#privacy:not(.hidden)")) {
      await page.click("#privacy-continue");
    }
    await page.waitForSelector("#game:not(.hidden), #ghost-turn:not(.hidden), #end:not(.hidden)");

    // If ghost turn: skip
    if (await page.$("#ghost-turn:not(.hidden)")) {
      await page.click("#ghost-skip");
      return;
    }
    // If end: stop
    if (await page.$("#end:not(.hidden)")) return "end";

    // Pick first enabled action
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

    // If the card stage has options, click the first
    await page.waitForTimeout(100);
    const cardOpt = await page.$("#card-stage .card-options button");
    if (cardOpt) await cardOpt.click();

    // If a target chooser appeared
    await page.waitForTimeout(50);
  }

  for (let i = 0; i < 50; i++) {
    const res = await playOneTurn();
    if (res === "end") break;
  }

  // Final state — log the current screen
  const visible = await page.$$eval(".screen:not(.hidden)", (els) => els.map(e => e.id));
  const logLines = await page.$$eval("#log .log-line", (els) => els.slice(0, 10).map(e => e.textContent));
  const endTitle = await page.$eval("#end-title", e => e.textContent).catch(() => null);

  console.log("Active screens:", visible);
  if (endTitle) console.log("End title:", endTitle);
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
