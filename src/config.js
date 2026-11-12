import { parseCookieHeader } from './guard.js';

const DEFAULT_TIMEOUT_MS = 45_000;

function bool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function int(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Parse an optional JSON object env var; bad input degrades to {}. */
export function parseJsonObject(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

/**
 * Build runtime configuration from environment + CLI flags.
 *
 * @param {string[]} argv process.argv.slice(2)
 */
export function loadConfig(env = process.env, argv = []) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const cookie = (env.SEAART_COOKIE || '').trim();
  const userAgent = (env.SEAART_USER_AGENT || '').trim();

  const missing = [];
  if (!cookie) missing.push('SEAART_COOKIE');
  if (!userAgent) missing.push('SEAART_USER_AGENT');

  const config = {
    cookie,
    userAgent,
    cookieDomain: (env.SEAART_COOKIE_DOMAIN || '.seaart.ai').trim(),
    locale: (env.SEAART_LOCALE || 'zhTW').trim(),
    headless: !flags.has('--headed') && bool(env.SEAART_HEADLESS, true),
    dryRun: flags.has('--dry-run') || bool(env.SEAART_DRY_RUN, false),
    dump: flags.has('--dump') || bool(env.SEAART_DUMP, false),
    dumpDir: (env.SEAART_DUMP_DIR || './dump').trim(),
    timeoutMs: int(env.SEAART_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    settleMs: int(env.SEAART_SETTLE_MS, 2_500),
    slowMo: int(env.SEAART_SLOW_MO, 0),
    // Task pages. Verified 2026-11-12 against a live account:
    //  - daily check-in lives in the battle-pass "season tasks → daily" panel
    //  - daily gift box lives on the decorations (飾品商城) page
    urls: {
      checkin: (env.SEAART_CHECKIN_URL ||
        'https://www.seaart.ai/zhTW/battlePass').trim(),
      gift: (env.SEAART_GIFT_URL ||
        'https://www.seaart.ai/zhTW/decorations').trim(),
      home: (env.SEAART_HOME_URL || 'https://www.seaart.ai/zhTW').trim()
    },
    discover: flags.has('--discover') || bool(env.SEAART_DISCOVER, false),
    // Optional localStorage snapshot (JSON object). Some sites keep part of the
    // session there, so cookie-only login can look "logged in" but not be.
    localStorage: parseJsonObject(env.SEAART_LOCAL_STORAGE),
    // Verified selectors are defaults; env vars only override them.
    selectors: {
      checkinEntry: (env.SEAART_CHECKIN_ENTRY || '.checkin-go-btn').trim(),
      checkinClaim: (env.SEAART_CHECKIN_CLAIM || '').trim(),
      giftEntry: (env.SEAART_GIFT_ENTRY || '').trim(),
      giftClaim: (env.SEAART_GIFT_CLAIM || env.SEAART_CLAIM_BUTTON || '.gift-button').trim()
    }
  };

  config.cookies = missing.length === 0
    ? parseCookieHeader(config.cookie, config.cookieDomain)
    : [];

  return { config, missing };
}
