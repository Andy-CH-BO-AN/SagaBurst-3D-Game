const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function runQA() {
  console.log('=== Starting Custom Battle Browser QA ===');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore known favicon 404 or extension noise
      if (!text.includes('favicon.ico') && !text.includes('chrome-extension')) {
        errors.push(text);
      }
    }
  });

  page.on('pageerror', err => {
    errors.push(err.message);
  });

  const outDir = path.resolve(__dirname, '../output/browser');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // ──────────────────────────────────────────────────────────
  // Scenario 1: Setup UI & 4 vs 4 Battle
  // ──────────────────────────────────────────────────────────
  console.log('\n--- Running Scenario 1: 4 vs 4 Battle ---');
  await page.goto('http://localhost:5174/?nolock');
  await page.waitForSelector('#battle-setup-container');

  // Configure 4v4: 1 Inf, 1 Archer, 1 Cavalry, 1 Horse Archer per side
  // First click preset-reset to start clean
  await page.click('#preset-reset');
  
  // Set all to 0 first, then set 1 each
  await page.evaluate(() => {
    const config = {
      viking: {
        infantry: { 1: 1, 2: 0, 3: 0 },
        archer: { 1: 0, 2: 1, 3: 0 },
        cavalry: { 1: 0, 2: 1, 3: 0 },
        horseArcher: { 1: 0, 2: 0, 3: 1 },
      },
      roman: {
        infantry: { 1: 1, 2: 0, 3: 0 },
        archer: { 1: 0, 2: 1, 3: 0 },
        cavalry: { 1: 0, 2: 1, 3: 0 },
        horseArcher: { 1: 0, 2: 0, 3: 1 },
      },
      rules: { respawnEnabled: false, includeCamps: true },
    };
    // Trigger reset with this config
    const ui = window.__setupUI;
    sessionStorage.setItem('sagaburst_battle_config', JSON.stringify(config));
  });

  // Reload with the 4v4 config directly via sessionStorage or click start
  await page.reload();
  await page.waitForSelector('#asset-loading-status, canvas');
  console.log('Battle loading...');
  await page.waitForSelector('#asset-loading-status', { state: 'detached', timeout: 30000 });
  await page.waitForSelector('#battle-status-hud');

  await page.screenshot({ path: path.join(outDir, '01-battle-4v4-start.png') });
  console.log('Captured 01-battle-4v4-start.png');

  // Verify game state via page.evaluate
  const startState = await page.evaluate(() => {
    const game = window.game;
    return {
      npcCount: game.npcs.length,
      vikingCount: game.npcs.filter(n => n.faction === 'PLAYER').length,
      romanCount: game.npcs.filter(n => n.faction === 'ENEMY').length,
      mountCount: game.mounts.length,
      pickupCount: game.pickups.length,
      vikingAliveHud: document.getElementById('hud-viking-alive')?.textContent,
      romanAliveHud: document.getElementById('hud-roman-alive')?.textContent,
    };
  });
  console.log('Initial battle state:', startState);

  if (startState.vikingCount !== 4 || startState.romanCount !== 4) {
    throw new Error(`Expected 4 Viking and 4 Roman NPCs, got ${startState.vikingCount} vs ${startState.romanCount}`);
  }
  if (startState.mountCount < 14) {
    // 4 cavalry/horse archers (2 per side) + 10 camp horses = 14 mounts!
    throw new Error(`Expected at least 14 mounts (4 riders + 10 camp horses), got ${startState.mountCount}`);
  }

  // Wait for combat to progress and one side to win
  console.log('Waiting for battle to conclude...');
  await page.waitForSelector('#battle-result-modal', { timeout: 120000 });
  const victoryText = await page.textContent('#battle-result-modal h1');
  console.log('Battle Result:', victoryText);

  await page.screenshot({ path: path.join(outDir, '02-battle-4v4-victory.png') });
  console.log('Captured 02-battle-4v4-victory.png');

  // Click BACK TO SETUP
  console.log('Clicking BACK TO SETUP...');
  await page.click('#btn-back-setup');
  await page.waitForSelector('#battle-setup-container');
  console.log('Returned to Setup UI successfully!');

  // ──────────────────────────────────────────────────────────
  // Scenario 2: 1 vs 1 Duel & Rematch Verification (Scenario E)
  // ──────────────────────────────────────────────────────────
  console.log('\n--- Running Scenario 2: 1 vs 1 Duel & REMATCH ---');
  await page.evaluate(() => {
    // Clear and configure 1 vs 1
    sessionStorage.setItem('sagaburst_battle_config', JSON.stringify({
      viking: {
        infantry: { 1: 1, 2: 0, 3: 0 },
        archer: { 1: 0, 2: 0, 3: 0 },
        cavalry: { 1: 0, 2: 0, 3: 0 },
        horseArcher: { 1: 0, 2: 0, 3: 0 },
      },
      roman: {
        infantry: { 1: 1, 2: 0, 3: 0 },
        archer: { 1: 0, 2: 0, 3: 0 },
        cavalry: { 1: 0, 2: 0, 3: 0 },
        horseArcher: { 1: 0, 2: 0, 3: 0 },
      },
      rules: { respawnEnabled: false, includeCamps: true },
    }));
  });
  await page.reload();
  await page.waitForSelector('#battle-status-hud');

  console.log('Waiting for 1v1 duel to finish...');
  await page.waitForSelector('#battle-result-modal', { timeout: 45000 });
  console.log('1v1 duel finished, testing REMATCH button...');

  // Click REMATCH
  await page.click('#btn-rematch');
  await page.waitForSelector('#battle-status-hud');
  console.log('Rematch successfully reloaded 1v1 battle!');
  await page.screenshot({ path: path.join(outDir, '03-rematch-1v1.png') });

  // ──────────────────────────────────────────────────────────
  // Scenario 3: 50 vs 50 Mixed Army (Scenario B)
  // ──────────────────────────────────────────────────────────
  console.log('\n--- Running Scenario 3: 50 vs 50 Full Scale Mixed Army ---');
  // Clear sessionStorage to enter setup UI
  await page.evaluate(() => sessionStorage.removeItem('sagaburst_battle_config'));
  await page.goto('http://localhost:5174/?nolock');
  await page.waitForSelector('#battle-setup-container');

  // Click 50 VS 50 preset
  await page.click('#preset-50');
  const vTotal = await page.textContent('#viking-total');
  const rTotal = await page.textContent('#roman-total');
  console.log(`50v50 Preset totals: Viking = ${vTotal}, Roman = ${rTotal}`);

  if (vTotal !== '50' || rTotal !== '50') {
    throw new Error(`50v50 preset totals incorrect: ${vTotal} / ${rTotal}`);
  }

  // Click START BATTLE
  await page.click('#btn-start-battle');
  await page.waitForSelector('#battle-status-hud', { timeout: 45000 });
  await page.waitForTimeout(2000); // Allow entities to initialize

  const army50State = await page.evaluate(() => {
    return {
      totalNpcs: window.game.npcs.length,
      vikingNpcs: window.game.npcs.filter(n => n.faction === 'PLAYER').length,
      romanNpcs: window.game.npcs.filter(n => n.faction === 'ENEMY').length,
      mounts: window.game.mounts.length,
    };
  });
  console.log('50v50 battle running:', army50State);
  await page.screenshot({ path: path.join(outDir, '04-battle-50v50.png') });
  console.log('Captured 04-battle-50v50.png');

  if (army50State.vikingNpcs !== 50 || army50State.romanNpcs !== 50) {
    throw new Error(`Expected 50 Viking and 50 Roman NPCs, got ${army50State.vikingNpcs} vs ${army50State.romanNpcs}`);
  }

  // ──────────────────────────────────────────────────────────
  // Scenario 4: Developer Studio Bypass (?devmodels=mounts)
  // ──────────────────────────────────────────────────────────
  console.log('\n--- Running Scenario 4: Developer Studio Bypass ---');
  await page.goto('http://localhost:5174/?devmodels=mounts&nolock');
  await page.waitForSelector('canvas');
  await page.waitForTimeout(1500);

  const studioState = await page.evaluate(() => {
    return {
      isMountStudio: window.game.isMountStudio,
      mountsCount: window.game.mounts.length,
      setupContainerPresent: Boolean(document.getElementById('battle-setup-container')),
    };
  });
  console.log('Mount Studio state:', studioState);
  if (!studioState.isMountStudio || studioState.setupContainerPresent) {
    throw new Error('Mount studio was not properly loaded or was blocked by setup UI');
  }
  await page.screenshot({ path: path.join(outDir, '05-devmodels-mounts.png') });
  console.log('Captured 05-devmodels-mounts.png');

  await browser.close();

  if (errors.length > 0) {
    console.error('Browser errors captured:', errors);
    throw new Error(`Browser console errors detected: ${errors.join(', ')}`);
  }

  console.log('\n=== All Browser QA Scenarios PASSED! ===');
}

runQA().catch(err => {
  console.error('QA FAILED:', err);
  process.exit(1);
});
