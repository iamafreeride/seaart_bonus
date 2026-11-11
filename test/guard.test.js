import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCookieHeader,
  findBlockWord,
  isClaimLabel,
  isEntryLabel,
  BLOCK_WORDS
} from '../src/guard.js';

test('parseCookieHeader splits a raw header', () => {
  const cookies = parseCookieHeader('a=1; b=two=three; c=;', '.seaart.ai');
  assert.equal(cookies.length, 3);
  assert.deepEqual(
    cookies.map((c) => [c.name, c.value]),
    [
      ['a', '1'],
      ['b', 'two=three'],
      ['c', '']
    ]
  );
  assert.equal(cookies[0].domain, '.seaart.ai');
  assert.equal(cookies[0].path, '/');
  assert.equal(cookies[0].secure, true);
});

test('parseCookieHeader rejects junk', () => {
  assert.throws(() => parseCookieHeader(''), /required/);
  assert.throws(() => parseCookieHeader(';;;'), /name=value/);
  assert.throws(() => parseCookieHeader('novalue'), /name=value/);
});

test('level rewards and blind boxes are blocked', () => {
  assert.equal(findBlockWord('一鍵全領'), '一鍵全領');
  assert.equal(findBlockWord('等級獎勵 領取'), '等級獎勵');
  assert.equal(findBlockWord('開啟盲盒'), '盲盒');
  assert.equal(findBlockWord('我的背包'), '背包');
  assert.equal(findBlockWord('立即解鎖 進階獎勵'), '進階獎勵');
  assert.equal(findBlockWord('立即訂閱'), '訂閱');
  assert.equal(findBlockWord('領取'), null);
});

test('claim labels are recognised', () => {
  assert.ok(isClaimLabel('領取'));
  assert.ok(isClaimLabel('立即領取'));
  assert.ok(isClaimLabel('開啟禮盒'));
  assert.ok(!isClaimLabel('取消'));
});

test('gift entry never matches a mystery box', () => {
  assert.ok(isEntryLabel('每日禮盒', 'gift'));
  assert.ok(isEntryLabel('禮盒', 'gift'));
  assert.ok(!isEntryLabel('驚喜盲盒', 'gift'));
  assert.ok(!isEntryLabel('盲盒', 'gift'));
});

test('check-in entry matches both scripts', () => {
  assert.ok(isEntryLabel('每日簽到', 'checkin'));
  assert.ok(isEntryLabel('签到', 'checkin'));
  assert.ok(!isEntryLabel('等級獎勵', 'checkin'));
});

test('blocklist has no duplicates', () => {
  assert.equal(new Set(BLOCK_WORDS).size, BLOCK_WORDS.length);
});
