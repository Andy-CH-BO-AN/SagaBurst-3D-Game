const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

async function runQA() {
  console.log("=== Starting Comprehensive Custom Battle Browser QA ===");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  const errors = [];
  page.on("console", msg => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (!text.includes("favicon.ico") && !text.includes("chrome-extension") && !text.includes("pointer lock")) {
        errors.push(text);
      }
    }
  });

  page.on("pageerror", err => {
    if (!err.message.includes("pointer lock")) {
      errors.push(err.message);
    }
  });

  const outDir = path.resolve(__dirname, "../output/browser");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // ──────────────────────────────────────────────────────────
  // Scenario 1: Setup UI Interactive Input & Asymmetric Battle (1 vs 50)
  // ──────────────────────────────────────────────────────────
  console.log("\n--- Scenario 1: Setup UI Interactive Input (1 vs 50) ---");
  await page.goto("http://localhost:5174/?nolock");
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.waitForSelector("#preset-reset");

  // Click RESET -> verify 0 vs 0
  await page.click("#preset-reset");
  await page.waitForTimeout(200);

  const resetV = await page.$eval("#viking-total", el => el.textContent.trim());
  const resetR = await page.$eval("#roman-total", el => el.textContent.trim());
  const startDisabled = await page.$eval("#btn-start-battle", el => el.disabled);
  console.log(`Reset status: Viking=${resetV}, Roman=${resetR}, startDisabled=${startDisabled}`);
  if (resetV !== "0" || resetR !== "0" || !startDisabled) {
    throw new Error("RESET did not clear armies to 0 vs 0 or did not disable start button");
  }

  // Type 1 in Viking T1 Infantry
  const vikingInput = await page.$("#val-viking-infantry-1");
  await vikingInput.fill("1");
  await vikingInput.dispatchEvent("input");

  // Type 50 in Roman T1 Infantry
  const romanInput = await page.$("#val-roman-infantry-1");
  await romanInput.fill("50");
  await romanInput.dispatchEvent("input");
  await page.waitForTimeout(200);

  const inputV = await page.$eval("#viking-total", el => el.textContent.trim());
  const inputR = await page.$eval("#roman-total", el => el.textContent.trim());
  const startEnabled = await page.$eval("#btn-start-battle", el => !el.disabled);
  console.log(`Input totals: Viking=${inputV}, Roman=${inputR}, startEnabled=${startEnabled}`);
  if (inputV !== "1" || inputR !== "50" || !startEnabled) {
    throw new Error(`Asymmetric input totals incorrect: Viking ${inputV}, Roman ${inputR}`);
  }

  // Start battle
  await page.click("#btn-start-battle");
  await page.waitForSelector("#battle-status-hud", { timeout: 30000 });
  await page.waitForTimeout(1500);

  const asymmState = await page.evaluate(() => {
    const game = window.game;
    const vNpcs = game.npcs.filter(n => n.faction === "PLAYER");
    const rNpcs = game.npcs.filter(n => n.faction === "ENEMY");
    const playerPos = game.player.group.position;
    let minVikingDistToPlayer = 999;
    for (const v of vNpcs) {
      const d = Math.hypot(v.spawnX - playerPos.x, v.spawnZ - playerPos.z);
      if (d < minVikingDistToPlayer) minVikingDistToPlayer = d;
    }
    return {
      vikingCount: vNpcs.length,
      romanCount: rNpcs.length,
      minVikingDistToPlayer,
    };
  });
  console.log("Asymmetric 1 vs 50 state:", asymmState);
  if (asymmState.vikingCount !== 1 || asymmState.romanCount !== 50) {
    throw new Error(`Expected 1 Viking and 50 Roman NPCs, got ${asymmState.vikingCount} vs ${asymmState.romanCount}`);
  }
  if (asymmState.minVikingDistToPlayer < 2.0) {
    throw new Error(`Viking NPC too close to player spawn: ${asymmState.minVikingDistToPlayer}m < 2.0m`);
  }
  await page.screenshot({ path: path.join(outDir, "qa-01-asymmetric-1v50.png") });

  // ──────────────────────────────────────────────────────────
  // Scenario 2: Horse Archer Properties & No-Respawn Validation (>10s window)
  // ──────────────────────────────────────────────────────────
  console.log("\n--- Scenario 2: Horse Archer & No-Respawn (>10s window) ---");
  await page.evaluate(() => sessionStorage.clear());
  await page.goto("http://localhost:5174/?nolock");
  await page.waitForSelector("#preset-10");
  await page.click("#preset-10");
  await page.click("#btn-start-battle");
  await page.waitForSelector("#battle-status-hud", { timeout: 30000 });
  await page.waitForTimeout(2000);

  const horseArcherValid = await page.evaluate(() => {
    const game = window.game;
    const horseArchers = game.npcs.filter(n => n.name.includes("Horse Archer"));
    if (horseArchers.length === 0) return { ok: false, reason: "No Horse Archer NPCs found" };
    for (const ha of horseArchers) {
      if (!ha.generatedAsCavalry) return { ok: false, reason: "Horse Archer generatedAsCavalry is false" };
      if (ha.aiType !== "RANGED") return { ok: false, reason: `Horse Archer aiType is ${ha.aiType}, expected RANGED` };
      if (!ha.mount) return { ok: false, reason: "Horse Archer mount is null" };
    }
    return { ok: true, count: horseArchers.length };
  });
  console.log("Horse Archer validation:", horseArcherValid);
  if (!horseArcherValid.ok) throw new Error(horseArcherValid.reason);

  // Test no-respawn by defeating an NPC and waiting > 10.0s (RESPAWN_TIME is 10.0s)
  console.log("Testing no-respawn: applying lethal damage to NPC...");
  await page.evaluate(() => {
    window.game.npcs[0].takeDamage(999);
  });
  const isDead = await page.evaluate(() => window.game.npcs[0].dead);
  console.log("NPC is dead:", isDead);
  if (!isDead) throw new Error("NPC did not register death after lethal damage");

  console.log("Waiting 11.0s (past the 10.0s RESPAWN_TIME window)...");
  await page.waitForTimeout(11000);
  const stillDead = await page.evaluate(() => window.game.npcs[0].dead);
  console.log("NPC remains dead after 11.0s:", stillDead);
  if (!stillDead) throw new Error("NPC resurrected even though respawnEnabled was false!");
  await page.screenshot({ path: path.join(outDir, "qa-02-combat-horse-archers.png") });

  // ──────────────────────────────────────────────────────────
  // Scenario 3: ?devcombat Bypass & Camp-Free
  // ──────────────────────────────────────────────────────────
  console.log("\n--- Scenario 3: ?devcombat Bypass & Camp-Free ---");
  await page.goto("http://localhost:5174/?devcombat&nolock");
  await page.waitForSelector("canvas");
  await page.waitForFunction(() => window.game && window.game.npcs && window.game.npcs.length >= 100, { timeout: 45000 });

  const devcombatState = await page.evaluate(() => {
    const game = window.game;
    return {
      setupContainerPresent: Boolean(document.getElementById("battle-setup-container")),
      pickupsCount: game.pickups.length,
      mountsCount: game.mounts.length,
      npcsCount: game.npcs.length,
    };
  });
  console.log("?devcombat state:", devcombatState);
  if (devcombatState.setupContainerPresent) {
    throw new Error("?devcombat was blocked by setup UI");
  }
  if (devcombatState.pickupsCount !== 0) {
    throw new Error(`Expected 0 camp pickups in ?devcombat, got ${devcombatState.pickupsCount}`);
  }
  // All mounts in devcombat should strictly equal total cavalry units (0 spare camp horses)
  const riderMounts = await page.evaluate(() => window.game.npcs.filter(n => n.generatedAsCavalry).length);
  if (devcombatState.mountsCount !== riderMounts) {
    throw new Error(`Expected ${riderMounts} rider mounts and 0 camp horses, got ${devcombatState.mountsCount}`);
  }
  await page.screenshot({ path: path.join(outDir, "qa-03-devcombat.png") });

  // ──────────────────────────────────────────────────────────
  // Scenario 4: Developer Bypasses (?devmodels=humans) & Modifier (?legacyhumanoids)
  // ──────────────────────────────────────────────────────────
  console.log("\n--- Scenario 4: Developer Bypasses (?devmodels=humans) & Modifier (?legacyhumanoids) ---");
  await page.goto("http://localhost:5174/?devmodels=humans&nolock");
  await page.waitForSelector("canvas");
  await page.waitForFunction(() => window.game && window.game.isHumanoidStudio !== undefined, { timeout: 30000 });

  const humansState = await page.evaluate(() => {
    return {
      isHumanoidStudio: window.game.isHumanoidStudio,
      setupContainerPresent: Boolean(document.getElementById("battle-setup-container")),
    };
  });
  console.log("?devmodels=humans state:", humansState);
  if (!humansState.isHumanoidStudio || humansState.setupContainerPresent) {
    throw new Error("?devmodels=humans bypass failed or was blocked by setup UI");
  }

  // ?legacyhumanoids alone is a rendering modifier and must NOT bypass the setup UI
  await page.evaluate(() => sessionStorage.clear());
  await page.goto("http://localhost:5174/?legacyhumanoids&nolock");
  await page.waitForSelector("#battle-setup-container", { timeout: 15000 });
  const legacyInSetup = await page.evaluate(() => Boolean(document.getElementById("battle-setup-container")));
  console.log("?legacyhumanoids correctly shows Setup UI:", legacyInSetup);
  if (!legacyInSetup) {
    throw new Error("?legacyhumanoids alone should show Setup UI");
  }

  // ?devcombat&legacyhumanoids bypasses setup UI directly into DevCombat with legacy rendering
  await page.goto("http://localhost:5174/?devcombat&legacyhumanoids&nolock");
  await page.waitForSelector("canvas");
  await page.waitForFunction(() => window.game && window.game.isDevCombat !== undefined, { timeout: 30000 });
  const devcombatLegacyState = await page.evaluate(() => {
    return {
      setupContainerPresent: Boolean(document.getElementById("battle-setup-container")),
      npcsCount: window.game.npcs.length,
    };
  });
  console.log("?devcombat&legacyhumanoids bypasses Setup UI:", devcombatLegacyState);
  if (devcombatLegacyState.setupContainerPresent) {
    throw new Error("?devcombat&legacyhumanoids should bypass setup UI");
  }

  // ──────────────────────────────────────────────────────────
  // Scenario 5: Mount Studio Mounted QA Initialization
  // ──────────────────────────────────────────────────────────
  console.log("\n--- Scenario 5: Mount Studio Mounted QA Initialization ---");
  await page.goto("http://localhost:5174/?devmodels=mounts&nolock");
  await page.waitForSelector("canvas");
  await page.waitForFunction(() => window.game && window.game.isMountStudio !== undefined, { timeout: 30000 });

  const mountStudioMountedState = await page.evaluate(() => {
    const game = window.game;
    const mountHud = document.getElementById("mount-hud");
    return {
      isMountStudio: game.isMountStudio,
      playerMounted: game.player.isMounted,
      hasCurrentMount: Boolean(game.player.currentMount),
      mountState: game.player.currentMount?.state,
      hudVisible: mountHud ? mountHud.classList.contains("visible") : false,
      mountName: document.getElementById("mount-name")?.textContent,
    };
  });
  console.log("Mount Studio mounted QA state:", mountStudioMountedState);
  if (!mountStudioMountedState.isMountStudio) {
    throw new Error("Expected isMountStudio to be true");
  }
  if (!mountStudioMountedState.playerMounted || !mountStudioMountedState.hasCurrentMount) {
    throw new Error("Player was not properly initialized as mounted in Mount Studio");
  }
  if (mountStudioMountedState.mountState !== "CONTROLLED") {
    throw new Error(`Expected horse mountState to be controlled, got ${mountStudioMountedState.mountState}`);
  }
  if (!mountStudioMountedState.hudVisible) {
    throw new Error("Mount HUD was not displayed in Mount Studio");
  }
  await page.screenshot({ path: path.join(outDir, "qa-05-mount-studio-mounted.png") });

  // ──────────────────────────────────────────────────────────
  // Scenario 6: Pointer Lock Overlay UX, Strict Gating & ESC (Live Mode)
  // ──────────────────────────────────────────────────────────
  console.log("\n--- Scenario 6: Pointer Lock Overlay UX, Strict Gating & ESC (Live Mode) ---");
  await page.goto("http://localhost:5174/?devcombat");
  await page.waitForSelector("canvas");
  await page.waitForFunction(() => window.game && window.game.input, { timeout: 30000 });

  const initialLockState = await page.evaluate(() => {
    const overlay = document.getElementById("lock-overlay");
    const prompt = document.getElementById("lock-overlay-prompt");
    return {
      isLocked: window.game.input.isLocked,
      overlayVisible: overlay && overlay.style.display !== "none" && !overlay.classList.contains("hidden"),
      promptText: prompt ? prompt.textContent.trim() : "",
    };
  });
  console.log("Initial live mode lock state:", initialLockState);
  if (initialLockState.isLocked) {
    throw new Error("PlayerInput should NOT be locked before user interaction in standard mode");
  }
  if (!initialLockState.overlayVisible || !initialLockState.promptText.includes("CLICK TO ENTER BATTLE")) {
    throw new Error("Lock overlay was not properly displayed on battle entry");
  }

  // Move mouse while unlocked -> ensure camera delta is NOT accumulated
  await page.mouse.move(300, 300);
  await page.mouse.move(400, 400);
  const unlockedDelta = await page.evaluate(() => window.game.input.consumeMouseDelta());
  console.log("Unlocked mouse delta:", unlockedDelta);
  if (unlockedDelta.dx !== 0 || unlockedDelta.dy !== 0) {
    throw new Error(`Mouse movement leaked into delta while unlocked: dx=${unlockedDelta.dx}, dy=${unlockedDelta.dy}`);
  }

  // Click overlay to enter battle -> ensure initial click does NOT trigger attack
  await page.click("#lock-overlay");
  const attackTriggeredOnLock = await page.evaluate(() => window.game.input.consumeLeftClick());
  console.log("Attack triggered on initial lock click:", attackTriggeredOnLock);
  if (attackTriggeredOnLock) {
    throw new Error("Initial click to acquire pointer lock must NOT trigger attack");
  }

  // Simulate pointer lock acquisition
  await page.evaluate(() => {
    Object.defineProperty(document, "pointerLockElement", { value: document.body, configurable: true });
    document.dispatchEvent(new Event("pointerlockchange"));
  });

  const lockedState = await page.evaluate(() => {
    const overlay = document.getElementById("lock-overlay");
    return {
      isLocked: window.game.input.isLocked,
      overlayHidden: overlay.classList.contains("hidden") || overlay.style.display === "none",
    };
  });
  console.log("Simulated pointer locked state:", lockedState);
  if (!lockedState.isLocked || !lockedState.overlayHidden) {
    throw new Error("Lock overlay did not hide or input did not lock upon acquiring pointer lock");
  }

  // When locked, mouse clicks properly trigger attacks
  const attackTriggeredWhenLocked = await page.evaluate(() => {
    window.dispatchEvent(new MouseEvent("mousedown", { button: 0 }));
    return window.game.input.consumeLeftClick();
  });
  console.log("Attack triggered when locked:", attackTriggeredWhenLocked);
  if (!attackTriggeredWhenLocked) {
    throw new Error("Expected left click to trigger attack when locked");
  }

  // Simulate ESC release
  await page.evaluate(() => {
    Object.defineProperty(document, "pointerLockElement", { value: null, configurable: true });
    document.dispatchEvent(new Event("pointerlockchange"));
  });

  const resumeOverlayState = await page.evaluate(() => {
    const overlay = document.getElementById("lock-overlay");
    const prompt = document.getElementById("lock-overlay-prompt");
    return {
      isLocked: window.game.input.isLocked,
      overlayVisible: overlay && overlay.style.display !== "none" && !overlay.classList.contains("hidden"),
      promptText: prompt ? prompt.textContent.trim() : "",
    };
  });
  console.log("Resume overlay state after ESC release:", resumeOverlayState);
  if (resumeOverlayState.isLocked) {
    throw new Error("PlayerInput should be unlocked after ESC release");
  }
  if (!resumeOverlayState.overlayVisible || !resumeOverlayState.promptText.includes("CLICK TO RESUME")) {
    throw new Error("Lock overlay did not show CLICK TO RESUME after pointer lock release");
  }

  // Moving mouse after ESC must NOT rotate camera / accumulate delta
  await page.mouse.move(200, 200);
  const escDelta = await page.evaluate(() => window.game.input.consumeMouseDelta());
  console.log("Mouse delta after ESC:", escDelta);
  if (escDelta.dx !== 0 || escDelta.dy !== 0) {
    throw new Error(`Mouse delta accumulated while unlocked after ESC: dx=${escDelta.dx}`);
  }

  // Clicking resume overlay to re-enter must NOT trigger attack
  await page.click("#lock-overlay");
  const attackOnResume = await page.evaluate(() => window.game.input.consumeLeftClick());
  console.log("Attack triggered on resume click:", attackOnResume);
  if (attackOnResume) {
    throw new Error("Resume click to re-acquire pointer lock must NOT trigger attack");
  }
  await page.screenshot({ path: path.join(outDir, "qa-06-lock-overlay-esc.png") });

  await browser.close();

  if (errors.length > 0) {
    console.error("Browser errors captured:", errors);
    throw new Error(`Browser console errors detected: ${errors.join(", ")}`);
  }

  console.log("\n=== All 6 Comprehensive Browser QA Scenarios PASSED! ===");
}

runQA().catch(err => {
  console.error("QA FAILED:", err);
  process.exit(1);
});
