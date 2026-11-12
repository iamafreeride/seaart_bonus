/**
 * Pure decision logic: cookie parsing, label matching, and the hard blocklist.
 *
 * Everything here is deliberately dependency-free so it can be unit-tested
 * without a browser.
 */

/** Words that must never be clicked, in Traditional and Simplified Chinese. */
export const BLOCK_WORDS = [
  // Battle-pass level rewards track — explicitly out of scope.
  '等級獎勵',
  '等级奖励',
  '一鍵全領',
  '一键全领',
  '進階獎勵',
  '进阶奖励',
  '立即解鎖',
  '立即解锁',
  // Backpack / mystery blind boxes — explicitly out of scope.
  '盲盒',
  '驚喜盲盒',
  '惊喜盲盒',
  '背包',
  // Commerce: this bot never buys anything.
  '購買',
  '购买',
  '訂閱',
  '订阅',
  '充值',
  '儲值',
  '付费',
  '付費',
  '定價',
  // Other activity surfaces that are not part of the two allowed actions.
  '兌換池',
  '兑换池',
  '排行榜',
  '升級',
  '升级'
];

/** Buttons that actually perform a claim. */
export const CLAIM_PATTERNS = [
  /領取/,
  /领取/,
  /領取獎勵/,
  /领取奖励/,
  /立即領取/,
  /立即领取/,
  /開啟/,
  /开启/,
  /立即開啟/,
  /立即开启/
];

/** Labels that identify the two allowed entries. */
export const ENTRY_PATTERNS = {
  checkin: /每日簽到|每日签到|簽到|签到/,
  gift: /每日禮盒|每日礼盒|禮盒|礼盒/
};

/** Container hints (class/id) that mean "not our business". */
export const BLOCK_CONTAINER_HINTS = [
  // Battle-pass level-reward track. Observed 2026-11-12 as
  // <div class="level-col__btn">領取</div> — must never be clicked.
  'level-col',
  'level-reward',
  'level-track',
  'level-award',
  'level-card',
  'level-progress',
  'tiv2-left__level',
  'battle-pass-level',
  'reward-track',
  'backpack',
  'blind-box',
  'blindbox',
  'shop',
  'goods',
  'payment',
  'pay-'
];

/** Overlay containers: claims are only ever clicked inside one of these. */
export const DIALOG_SELECTOR =
  '[role="dialog"], .el-dialog, .el-overlay-dialog, .el-message-box, .el-drawer';

export function normalize(text) {
  return String(text ?? '').replace(/\s+/gu, '');
}

/**
 * @param {string} text element text plus ancestor text
 * @returns {string|null} the matched block word, or null when allowed
 */
export function findBlockWord(text) {
  const flat = normalize(text);
  for (const word of BLOCK_WORDS) {
    if (flat.includes(word)) return word;
  }
  return null;
}

export function isClaimLabel(text) {
  const flat = normalize(text);
  if (!flat) return false;
  return CLAIM_PATTERNS.some((re) => re.test(flat));
}

/**
 * @param {string} text
 * @param {'checkin'|'gift'} kind
 */
export function isEntryLabel(text, kind) {
  const flat = normalize(text);
  if (!flat) return false;
  // A gift entry must never be a mystery blind box.
  if (kind === 'gift' && flat.includes('盲盒')) return false;
  return ENTRY_PATTERNS[kind].test(flat);
}

/**
 * Parse a raw Cookie request header into Playwright cookie objects.
 *
 * @param {string} header e.g. "a=1; b=2"
 * @param {string} domain cookie domain, usually ".seaart.ai"
 * @returns {Array<{name:string,value:string,domain:string,path:string,httpOnly:boolean,secure:boolean,sameSite:'None'}>}
 */
export function parseCookieHeader(header, domain = '.seaart.ai') {
  if (!header || typeof header !== 'string') {
    throw new Error('cookie header is required');
  }
  const cookies = [];
  for (const rawPart of header.split(';')) {
    const part = rawPart.trim();
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name) continue;
    cookies.push({
      name,
      value,
      domain,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'None'
    });
  }
  if (cookies.length === 0) {
    throw new Error('cookie header did not contain any name=value pairs');
  }
  return cookies;
}
