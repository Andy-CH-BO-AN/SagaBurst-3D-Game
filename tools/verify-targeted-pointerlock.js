const { chromium } = require("playwright");

async function main() {
  console.log("=== Targeted Verification: Immediate Mouse Look on START BATTLE ===");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  // 1. Normal URL (no ?nolock)
  await page.goto("http://localhost:5174");
  await page.waitForSelector("#btn-start-battle");

  // Mock realistic browser pointer lock behavior triggered by user gesture
  await page.evaluate(() => {
    let currentLocked = null;
    Object.defineProperty(document, "pointerLockElement", {
      get: () => currentLocked,
      set: (val) => { currentLocked = val; },
      configurable: true
    });
    Element.prototype.requestPointerLock = function() {
      currentLocked = this;
      document.dispatchEvent(new Event("pointerlockchange"));
      return Promise.resolve();
    };
    document.exitPointerLock = function() {
      currentLocked = null;
      document.dispatchEvent(new Event("pointerlockchange"));
    };
  });

  // 2. Select valid preset
  await page.click("#preset-10");

  // 3. Click START BATTLE - this invokes target.requestPointerLock() in the click handler!
  console.log("Step 3: Click START BATTLE");
  await page.click("#btn-start-battle");

  // 4. Wait for asset loading to finish
  console.log("Step 4: Waiting for battle to load...");
  await page.waitForSelector("canvas", { timeout: 30000 });
  await page.waitForFunction(() => window.game && window.game.thirdPersonCamera && window.game.input, { timeout: 30000 });

  // Verify PlayerInput isLocked is true AUTOMATICALLY on creation without any manual sync or extra clicks!
  const initialLock = await page.evaluate(() => {
    return {
      isLocked: window.game.input.isLocked,
      initialYaw: window.game.thirdPersonCamera.yaw
    };
  });
  console.log("Step 4 state after load (WITHOUT clicking or pressing ESC):", initialLock);
  if (!initialLock.isLocked) {
    throw new Error("Expected PlayerInput to be automatically locked on creation when pointer lock was acquired at START BATTLE!");
  }

  // 5 & 6. Move mouse left/right -> Camera must immediately rotate!
  console.log("Step 5 & 6: Moving mouse immediately without any extra clicks...");
  await page.evaluate(() => {
    document.dispatchEvent(new MouseEvent("mousemove", { movementX: 50, movementY: 0 }));
    window.game.thirdPersonCamera.update(window.game.input, 0.016);
  });
  const movedYaw = await page.evaluate(() => window.game.thirdPersonCamera.yaw);
  console.log("Yaw changed from " + initialLock.initialYaw + " to " + movedYaw);
  if (movedYaw === initialLock.initialYaw) {
    throw new Error("Camera yaw did not rotate on mouse move!");
  }

  // 7. Press ESC -> mouse movement must NOT rotate camera
  console.log("Step 7: Simulating ESC pointer lock release...");
  await page.evaluate(() => {
    document.exitPointerLock();
  });
  const escState = await page.evaluate(() => ({
    isLocked: window.game.input.isLocked,
    escYaw: window.game.thirdPersonCamera.yaw
  }));
  console.log("State after ESC:", escState);
  if (escState.isLocked) throw new Error("Expected isLocked to be false after ESC");

  // Move mouse while unlocked -> yaw MUST NOT change
  await page.evaluate(() => {
    document.dispatchEvent(new MouseEvent("mousemove", { movementX: 100, movementY: 0 }));
    window.game.thirdPersonCamera.update(window.game.input, 0.016);
  });
  const postEscYaw = await page.evaluate(() => window.game.thirdPersonCamera.yaw);
  console.log("Yaw after ESC mouse move: " + postEscYaw + " (was " + escState.escYaw + ")");
  if (postEscYaw !== escState.escYaw) {
    throw new Error("Camera yaw rotated while unlocked after ESC!");
  }

  // 8. Reacquire pointer lock with click -> must NOT trigger melee attack
  console.log("Step 8: Reacquire pointer lock via click...");
  const attackTriggered = await page.evaluate(() => {
    window.dispatchEvent(new MouseEvent("mousedown", { button: 0 }));
    return window.game.input.consumeLeftClick();
  });
  console.log("Attack triggered on reacquire click:", attackTriggered);
  if (attackTriggered) {
    throw new Error("Reacquire click triggered melee attack!");
  }

  // 9. Now locked again -> mouse move rotates camera normally
  console.log("Step 9: Mouse move after reacquire...");
  await page.evaluate(() => {
    document.querySelector("canvas").requestPointerLock();
    document.dispatchEvent(new MouseEvent("mousemove", { movementX: -80, movementY: 0 }));
    window.game.thirdPersonCamera.update(window.game.input, 0.016);
  });
  const finalYaw = await page.evaluate(() => window.game.thirdPersonCamera.yaw);
  console.log("Final yaw: " + finalYaw + " (was " + postEscYaw + ")");
  if (finalYaw === postEscYaw) {
    throw new Error("Camera yaw did not rotate after reacquiring pointer lock!");
  }

  await browser.close();
  console.log("\n=== ALL 9 TARGETED VERIFICATION STEPS PASSED SUCCESSFULLY! ===");
}

main().catch(err => {
  console.error("Targeted verification failed:", err);
  process.exit(1);
});
