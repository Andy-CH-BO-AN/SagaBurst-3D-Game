const { chromium } = require('playwright');
async function check() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:5174/?nolock');
  await page.evaluate(() => {
    sessionStorage.setItem('sagaburst_battle_config', JSON.stringify({
      viking: { infantry: { 1: 1, 2: 0, 3: 0 }, archer: { 1: 0, 2: 1, 3: 0 }, cavalry: { 1: 0, 2: 1, 3: 0 }, horseArcher: { 1: 0, 2: 0, 3: 1 } },
      roman: { infantry: { 1: 1, 2: 0, 3: 0 }, archer: { 1: 0, 2: 1, 3: 0 }, cavalry: { 1: 0, 2: 1, 3: 0 }, horseArcher: { 1: 0, 2: 0, 3: 1 } },
      rules: { respawnEnabled: false, includeCamps: true },
    }));
  });
  await page.reload();
  await page.waitForSelector('#battle-status-hud');
  for (let s = 1; s <= 20; s++) {
    await page.waitForTimeout(4000);
    const npcs = await page.evaluate(() => {
      return window.game.npcs.map(n => ({
        name: n.name,
        hp: n.hp,
        state: n.currentState,
        z: n.position.z.toFixed(1)
      }));
    });
    console.log(`=== Time: ${s*4}s ===`);
    console.log(npcs);
    const modal = await page.evaluate(() => Boolean(document.getElementById('battle-result-modal')));
    if (modal) {
      console.log('Battle concluded at', s*4, 'seconds!');
      break;
    }
  }
  await browser.close();
}
check().catch(console.error);
