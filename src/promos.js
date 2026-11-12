import { DIALOG_SELECTOR } from './guard.js';

/** Text that indicates a promotion/activity overlay rather than a task dialog. */
const PROMO_HINT =
  /vip|svip|會員|会员|訂閱|订阅|折扣|優惠|优惠|限時|限时|升級|升级|價格|价格|付費|付费|解鎖|解锁|體驗|体验|活動|活动|聯動|联动|大賽|大赛|抽獎|抽奖/i;

/** Call-to-action words we must never click, even to "close" a promo. */
export const PURCHASE_WORDS = [
  '立即體驗',
  '立即体验',
  '立即購買',
  '立即购买',
  '立即訂閱',
  '立即订阅',
  '立即開通',
  '立即开通',
  '馬上開通',
  '購買',
  '购买',
  '訂閱',
  '订阅',
  '充值',
  '儲值',
  '開通',
  '开通',
  '付款',
  '支付',
  '升級',
  '升级',
  '去支付'
];

/** Safe controls that dismiss a dialog without buying anything. */
const CLOSE_TEXTS = [
  /^關閉$/,
  /^关闭$/,
  /^稍後再說$/,
  /^稍后再说$/,
  /^以後再說$/,
  /^以后再说$/,
  /^暫不$/, 
  /^暂不$/,
  /^我知道了$/,
  /^知道了$/,
  /^跳過$/,
  /^跳过$/,
  /^不再提示$/,
  /^下次再說$/,
  /^下次再说$/
];

const CLOSE_SELECTORS = [
  '.el-dialog__headerbtn',
  '.el-drawer__close-btn',
  '[aria-label="關閉"]',
  '[aria-label="关闭"]',
  '[aria-label="Close"]',
  '[class*="close-btn"]',
  '[class*="closeBtn"]',
  '[class*="modal-close"]',
  '[class*="popup-close"]'
];

export function isPromoText(text) {
  const flat = String(text || '').replace(/\s+/gu, '');
  if (!flat) return false;
  return PROMO_HINT.test(flat);
}

/**
 * Close paid/VIP promotion overlays so they cannot intercept clicks.
 *
 * Safety rules:
 *  - only acts on overlays whose text looks like a promotion;
 *  - only clicks close controls or presses Escape;
 *  - never clicks anything containing a purchase CTA.
 *
 * @returns {Promise<string[]>} descriptions of what was closed
 */
export async function dismissPromos(page, log = () => {}) {
  const closed = [];
  for (let pass = 0; pass < 3; pass += 1) {
    const overlay = page.locator(DIALOG_SELECTOR);
    const count = await overlay.count().catch(() => 0);
    let acted = false;

    for (let i = 0; i < count; i += 1) {
      const node = overlay.nth(i);
      if (!(await node.isVisible().catch(() => false))) continue;
      const text = (await node.innerText().catch(() => '')).slice(0, 400);
      if (!isPromoText(text)) continue;
      if (PURCHASE_WORDS.some((w) => text.includes(w)) && !/關閉|关闭|稍後|以后|不再提示/.test(text)) {
        // Promo with only purchase CTAs: just press Escape, never click them.
        await page.keyboard.press('Escape').catch(() => {});
        closed.push('escape');
        acted = true;
        await page.waitForTimeout(600);
        break;
      }

      let clicked = false;
      for (const sel of CLOSE_SELECTORS) {
        const btn = node.locator(sel).first();
        if ((await btn.count().catch(() => 0)) && (await btn.isVisible().catch(() => false))) {
          const label = (await btn.innerText().catch(() => '')).replace(/\s+/gu, '');
          if (PURCHASE_WORDS.some((w) => label.includes(w))) continue;
          await btn.click({ timeout: 2_000 }).catch(() => {});
          closed.push(`close:${sel}`);
          clicked = true;
          break;
        }
      }

      if (!clicked) {
        for (const re of CLOSE_TEXTS) {
          const btn = node.getByText(re).first();
          if ((await btn.count().catch(() => 0)) && (await btn.isVisible().catch(() => false))) {
            await btn.click({ timeout: 2_000 }).catch(() => {});
            closed.push(`text:${re.source}`);
            clicked = true;
            break;
          }
        }
      }

      if (!clicked) {
        await page.keyboard.press('Escape').catch(() => {});
        closed.push('escape');
      }
      acted = true;
      await page.waitForTimeout(600);
      break;
    }

    if (!acted) break;
  }

  if (closed.length > 0) log(`promo dismissed: ${closed.join(', ')}`);
  return closed;
}
