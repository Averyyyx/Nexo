const { chromium } = require('playwright');

const baseUrl = process.env.NEXO_E2E_URL || 'http://127.0.0.1:4000';
const email = process.env.NEXO_E2E_EMAIL;
const password = process.env.NEXO_E2E_PASSWORD;

if (!email || !password) {
  throw new Error('Set NEXO_E2E_EMAIL and NEXO_E2E_PASSWORD for the seeded test account.');
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.locator('form').filter({ has: page.locator('input[type="email"]') }).locator('button[type="submit"]').click();
    await page.locator('.nexo-user-dock').waitFor({ state: 'visible', timeout: 30000 });

    for (const height of [700, 768, 800, 900, 1080]) {
      for (const zoom of [1, 1.25, 1.5]) {
        await page.setViewportSize({ width: 1440, height });
        await page.evaluate((factor) => { document.body.style.zoom = String(factor); }, zoom);
        await page.waitForTimeout(100);
        const metrics = await page.evaluate(() => {
          const dock = document.querySelector('.sidebar-user-area');
          const card = document.querySelector('.nexo-user-dock');
          const actions = document.querySelectorAll('.nexo-user-dock .dock-actions > button');
          return {
            bottom: dock?.getBoundingClientRect().bottom ?? Infinity,
            height: card?.getBoundingClientRect().height ?? 0,
            buttons: actions.length,
            viewport: window.innerHeight
          };
        });
        if (metrics.bottom > metrics.viewport + 1) throw new Error(`Dock overflow at ${height}px / ${zoom * 100}%: ${JSON.stringify(metrics)}`);
        if (metrics.buttons !== 3) throw new Error(`Expected three dock actions: ${JSON.stringify(metrics)}`);
        if (Math.abs(metrics.height - 52) > 2) throw new Error(`Unexpected dock height: ${JSON.stringify(metrics)}`);
      }
    }

    await page.evaluate(() => { document.body.style.zoom = '1'; });
    await page.locator('.dock-user .nexo-avatar').click();
    if (await page.locator('.dock-account-menu, .dock-menu-profile').count()) {
      throw new Error('Legacy account menu is still present.');
    }
    console.log('Dock layout checks passed for 700/768/800/900/1080 px at 100/125/150% zoom.');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
