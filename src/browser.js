import { dismissPromos } from './promos.js';

/**
 * Launch Chromium and build an authenticated context from the raw cookie
 * header plus the user agent. No credential ever leaves this process.
 *
 * `playwright` is imported lazily so that config-only paths (missing env,
 * --help, unit tests) work without the browser package installed.
 *
 * @param {object} config
 */
export async function openSession(config) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error(
      'playwright is not installed — run `npm install` locally, or use the Docker image where it is preinstalled'
    );
  }
  const browser = await chromium.launch({
    headless: config.headless,
    slowMo: config.slowMo || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  const context = await browser.newContext({
    userAgent: config.userAgent,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: {
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
    }
  });

  await context.addCookies(config.cookies);

  // Optional localStorage replay: some sessions keep an auth token there, so a
  // cookie-only login can render the avatar yet fail feature-gated requests.
  const storage = config.localStorage || {};
  if (Object.keys(storage).length > 0) {
    await context.addInitScript((entries) => {
      try {
        if (!/(^|\.)seaart\.(ai|me)$/.test(location.hostname)) return;
        for (const [key, value] of Object.entries(entries)) {
          window.localStorage.setItem(key, value);
        }
      } catch {
        /* private mode or quota — ignore */
      }
    }, storage);
  }

  // Match the locale the cookies were minted for.
  if (config.locale && config.locale !== 'zhTW') {
    await context.addCookies([
      {
        name: 'locale',
        value: config.locale,
        domain: config.cookieDomain,
        path: '/',
        httpOnly: false,
        secure: true,
        sameSite: 'None'
      }
    ]);
  }

  const page = await context.newPage();
  page.setDefaultTimeout(config.timeoutMs);
  page.setDefaultNavigationTimeout(config.timeoutMs);

  return { browser, context, page };
}

/**
 * Heuristic login probe. Returns { loggedIn, evidence }.
 * A false negative here does not stop the run — it only produces a warning.
 */
export async function probeLogin(page) {
  const probe = await page.evaluate(() => {
    const text = (document.body.innerText || '').replace(/\s+/g, '');
    const hasAvatar = !!document.querySelector(
      '[class*="avatar"],[class*="Avatar"],[class*="user-info"],[class*="userInfo"]'
    );
    const hasLoginCta = /登入|登录|Signin|SignIn/i.test(text);
    return { hasAvatar, hasLoginCta, sample: text.slice(0, 120) };
  });
  const loggedIn = probe.hasAvatar || !probe.hasLoginCta;
  return { loggedIn, evidence: probe };
}

/**
 * SeaArt is a Nuxt SPA: the SSR placeholder disappears long before the season
 * panel renders. The caller supplies the content signals it actually needs, so
 * "ready" means "the buttons we are going to click exist".
 */
export async function waitForAppReady(page, timeoutMs, signals = []) {
  await page.waitForSelector('.ssr-loading', { state: 'detached', timeout: 8_000 }).catch(() => {});

  const wanted = signals.length > 0 ? signals : ['#__nuxt > div', 'main'];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of wanted) {
      if (await page.locator(sel).first().count().catch(() => 0)) return true;
    }
    await page.waitForTimeout(400);
  }
  return false;
}

export async function gotoAndSettle(page, url, config, log = () => {}, signals = []) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const ready = await waitForAppReady(page, config.waitMs, signals);
  if (!ready) {
    log(`warning: no content signal within ${config.waitSeconds}s; continuing anyway`);
  }
  await page.waitForTimeout(Math.max(600, Math.floor(config.settleMs / 2)));
  // Cookie/announcement overlays first, then paid VIP promotions: both would
  // otherwise intercept pointer events on the real buttons.
  await dismissOverlays(page);
  await dismissPromos(page, log);
  await dismissOverlays(page);
}

async function dismissOverlays(page) {
  const labels = [/^我知道了$/, /^知道了$/, /^同意$/, /^接受$/, /^關閉$/, /^关闭$/];
  for (const label of labels) {
    const btn = page.getByRole('button', { name: label }).first();
    if (await btn.count().catch(() => 0)) {
      await btn.click({ timeout: 1_500 }).catch(() => {});
    }
  }
}
