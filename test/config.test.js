import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, parseJsonObject } from '../src/config.js';

test('parseJsonObject tolerates junk and arrays', () => {
  assert.deepEqual(parseJsonObject(''), {});
  assert.deepEqual(parseJsonObject('not json'), {});
  assert.deepEqual(parseJsonObject('[1,2]'), {});
  assert.deepEqual(parseJsonObject('{"a":"b"}'), { a: 'b' });
});

test('missing credentials are reported, not thrown', () => {
  const { config, missing } = loadConfig({}, []);
  assert.deepEqual(missing, ['SEAART_COOKIE', 'SEAART_USER_AGENT']);
  assert.deepEqual(config.cookies, []);
});

test('defaults match the verified surfaces', () => {
  const { config } = loadConfig(
    { SEAART_COOKIE: 'a=1', SEAART_USER_AGENT: 'UA/1.0' },
    []
  );
  // Verified against a live account on 2026-11-12.
  assert.equal(config.urls.checkin, 'https://www.seaart.ai/zhTW/battlePass');
  assert.equal(config.urls.gift, 'https://www.seaart.ai/zhTW/decorations');
  assert.equal(config.selectors.checkinEntry, '.checkin-go-btn');
  assert.equal(config.selectors.giftClaim, '.gift-button');
  assert.equal(config.locale, 'zhTW');
  assert.equal(config.headless, true);
  assert.equal(config.dryRun, false);
  assert.equal(config.cookies.length, 1);
});

test('selector env vars override the verified defaults', () => {
  const { config } = loadConfig(
    {
      SEAART_COOKIE: 'a=1',
      SEAART_USER_AGENT: 'UA/1.0',
      SEAART_CHECKIN_ENTRY: '.my-checkin',
      SEAART_GIFT_CLAIM: '.my-gift'
    },
    []
  );
  assert.equal(config.selectors.checkinEntry, '.my-checkin');
  assert.equal(config.selectors.giftClaim, '.my-gift');
});

test('CLI flags override environment', () => {
  const { config } = loadConfig(
    { SEAART_COOKIE: 'a=1', SEAART_USER_AGENT: 'UA/1.0' },
    ['--headed', '--dry-run', '--dump']
  );
  assert.equal(config.headless, false);
  assert.equal(config.dryRun, true);
  assert.equal(config.dump, true);
});

test('numeric and boolean env parsing is defensive', () => {
  const { config } = loadConfig(
    {
      SEAART_COOKIE: 'a=1',
      SEAART_USER_AGENT: 'UA/1.0',
      SEAART_TIMEOUT_MS: 'not-a-number',
      SEAART_HEADLESS: 'off'
    },
    []
  );
  assert.equal(config.timeoutMs, 45_000);
  assert.equal(config.headless, false);
});
