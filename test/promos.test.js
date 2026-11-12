import test from 'node:test';
import assert from 'node:assert/strict';
import { isPromoText, PURCHASE_WORDS } from '../src/promos.js';

test('VIP promotion text is recognised', () => {
  assert.ok(isPromoText('SVIP限時8折優惠 立即體驗'));
  assert.ok(isPromoText('SeaArt × HazeChat联动活动 选角色，一键做作品，赢 500 美金'));
  assert.ok(isPromoText('解鎖專業版會員，暢享unlimited'));
});

test('functional dialogs are not treated as promotions', () => {
  assert.equal(isPromoText('第1天 第2天 第3天 簽到'), false);
  assert.equal(isPromoText('每日禮盒 每日登錄即可免費開'), false);
  assert.equal(isPromoText(''), false);
});

test('purchase CTAs are enumerated for the never-click rule', () => {
  for (const word of ['立即體驗', '購買', '訂閱', '充值', '開通', '升級']) {
    assert.ok(PURCHASE_WORDS.includes(word), `missing ${word}`);
  }
  assert.ok(!PURCHASE_WORDS.includes('關閉'));
});
